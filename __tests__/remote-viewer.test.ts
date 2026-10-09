import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { promisify } from 'node:util'
import { finished } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildViewerArchive } from '../scripts/viewer/archive.mjs'
import { openViewerArchive, type ViewerArchive } from '../server/viewer-archive.ts'
import { admitViewerRelease, openReleasedViewer } from '../server/viewer-release.ts'
import { startEmbeddedViewer } from '../server/embedded.ts'
import type { RunningDevServer } from '../server/model.ts'
import { CATALOG_BOOTSTRAP_ENDPOINT, CATALOG_EVENTS_ENDPOINT, type CatalogBootstrap } from '../viewer-host/live.ts'
import { CATALOG_SPEC_ENDPOINT, type CatalogSpecPayload } from '../viewer-host/catalog.ts'
import { SOURCE_EDIT_HEADER } from '../application/interaction/editing.ts'
import { fixture, type Fixture } from './fixture.ts'

const builtAssets = resolve(import.meta.dirname, '../dist/viewer')
const sourceRevision = 'a'.repeat(40)
const packageVersion = '0.1.3'
const fixtures: Fixture[] = []
const archives: ViewerArchive[] = []
const servers: RunningDevServer[] = []
const run = promisify(execFile)

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(archives.splice(0).map((archive) => archive.close()))
  await Promise.all(fixtures.splice(0).map((item) => item.remove()))
})

async function release(realBundle = false) {
  const project = await fixture({
    'assets/index.html': '<script src="/assets/main.js"></script>',
    'assets/assets/main.js': 'console.log("viewer")',
    'assets/assets/empty.txt': '',
    'assets/THIRD_PARTY_NOTICES.txt': 'License notices',
    'assets/viewer-build.json': '{"packages":[]}',
    'domain/alpha/.spec/api.d.ts': 'export interface Alpha {}\n',
  })
  fixtures.push(project)
  const bundle = await buildViewerArchive(realBundle ? builtAssets : join(project.root, 'assets'))
  const header = { format: 'codegraph.viewer-release.v1', packageVersion, sourceRevision, asset: `viewer-${sourceRevision}.tar.gz`, ...bundle.descriptor }
  const packageRoot = join(project.root, 'package')
  const cache = join(project.root, 'cache')
  await mkdir(packageRoot)
  await Promise.all([
    writeFile(join(packageRoot, 'package.json'), JSON.stringify({ version: packageVersion })),
    writeFile(join(packageRoot, 'viewer-release.json'), JSON.stringify(header)),
    writeFile(join(packageRoot, 'native-release.json'), JSON.stringify({ packageVersion, sourceRevision })),
  ])
  const path = join(cache, `viewer-${header.sha256}.tar`)
  return { project, packageRoot, cache, path, header, ...bundle }
}

function delivery(gzip: Buffer) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe(`https://github.com/astrale-os/exp-codegraph/releases/download/codegraph-v${packageVersion}-${sourceRevision}/viewer-${sourceRevision}.tar.gz`)
    const response = new Response(gzip)
    Object.defineProperty(response, 'url', { value: String(input) })
    return response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

async function acquire(item: Awaited<ReturnType<typeof release>>, signal?: AbortSignal) {
  const archive = await openReleasedViewer(item.packageRoot, item.cache, signal ? { signal } : {})
  archives.push(archive)
  return archive
}

async function text(archive: ViewerArchive, path: string) {
  let result = ''
  for await (const chunk of archive.stream(path)) result += chunk.toString()
  return result
}

describe('source-bound remote viewer cache', () => {
  it('downloads once for concurrent consumers, retaining only the verified raw tar', async () => {
    const item = await release()
    const fetcher = delivery(item.gzip)
    const consumers = await Promise.all(Array.from({ length: 8 }, () => acquire(item)))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(await readdir(item.cache)).toEqual([`viewer-${item.header.sha256}.tar`])
    expect(await readFile(item.path)).toEqual(item.tar)
    for (const archive of consumers) expect(await text(archive, 'assets/main.js')).toBe('console.log("viewer")')
  })

  it('opens offline after preload and repairs corruption without retargeting an active reader', async () => {
    const item = await release()
    const fetcher = delivery(item.gzip)
    const retained = await acquire(item)
    // A concurrent cache writer replaces a corrupt inode; existing responses retain their admitted inode.
    const corrupt = join(item.cache, 'corrupt')
    await writeFile(corrupt, Buffer.alloc(item.tar.length))
    await rename(corrupt, item.path)
    const repaired = await acquire(item)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await text(retained, 'index.html')).toBe(await text(repaired, 'index.html'))
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('offline') }))
    const offline = await acquire(item)
    expect(await text(offline, 'assets/main.js')).toContain('viewer')
    expect(fetch).not.toHaveBeenCalled()
    await retained.close()
    expect(retained.close()).toBe(retained.close())
    expect(() => retained.stream('index.html')).toThrow('closed')
  })

  it('rejects a mismatched cohort before network access', async () => {
    const item = await release()
    const fetcher = delivery(item.gzip)
    await writeFile(join(item.packageRoot, 'native-release.json'), JSON.stringify({ packageVersion, sourceRevision: 'b'.repeat(40) }))
    await expect(acquire(item)).rejects.toThrow('does not match')
    expect(fetcher).not.toHaveBeenCalled()
    for (const patch of [{ packageVersion: '0.1.4' }, { asset: '../viewer.tar.gz' }, { bytes: 257 * 1024 * 1024 }, { sha256: 'invalid' }]) {
      expect(() => admitViewerRelease({ ...item.header, ...patch }, packageVersion, sourceRevision)).toThrow('does not match')
    }
  })

  it('rejects encoded and decoded corruption, cleaning owned staging before recovery', async () => {
    const item = await release()
    delivery(Buffer.from('invalid gzip'))
    await expect(acquire(item)).rejects.toThrow()
    expect(await readdir(item.cache)).toEqual([])
    const altered = Buffer.from(item.tar)
    altered[512] = altered[512]! ^ 1
    const gzip = gzipSync(altered)
    await writeFile(join(item.packageRoot, 'viewer-release.json'), JSON.stringify({ ...item.header, compression: { format: 'gzip', bytes: gzip.length, sha256: digest(gzip) } }))
    delivery(gzip)
    await expect(acquire(item)).rejects.toThrow()
    expect(await readdir(item.cache)).toEqual([])
    await writeFile(join(item.packageRoot, 'viewer-release.json'), JSON.stringify(item.header))
    delivery(item.gzip)
    expect(await text(await acquire(item), 'index.html')).toContain('script')
  })

  it('cancels one download without cancelling an unrelated acquisition or publishing partial bytes', async () => {
    const item = await release()
    const abort = new AbortController()
    let streaming!: () => void
    const ready = new Promise<void>((resolveReady) => { streaming = resolveReady })
    let count = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const response = ++count === 1 ? new Response(new ReadableStream({ start(controller) { controller.enqueue(item.gzip.subarray(0, 10)); streaming() } })) : new Response(item.gzip)
      Object.defineProperty(response, 'url', { value: String(input) })
      return response
    }))
    const interrupted = acquire(item, abort.signal)
    await ready
    const independent = acquire(item)
    abort.abort(new Error('caller cancelled'))
    await expect(interrupted).rejects.toThrow('caller cancelled')
    expect(await text(await independent, 'index.html')).toContain('script')
    expect(await readdir(item.cache)).toEqual([`viewer-${item.header.sha256}.tar`])
    const preabort = new AbortController()
    preabort.abort(new Error('already cancelled'))
    await expect(acquire(item, preabort.signal)).rejects.toThrow('already cancelled')
    expect(count).toBe(2)
  })
})

describe('bounded pinned ustar viewer', () => {
  it('keeps compiled checkout HMR automatic, without requiring release metadata or a download', async () => {
    const project = await fixture({ 'alpha/.spec/api.d.ts': 'export interface Alpha {}\n' })
    fixtures.push(project)
    const download = vi.fn(() => { throw new Error('Source checkout attempted a download.') })
    vi.stubGlobal('fetch', download)
    const compiled = await import(pathToFileURL(resolve(import.meta.dirname, '../dist/server/index.js')).href)
    const server: RunningDevServer = await compiled.startDev({ root: project.root, port: 0, cache: false })
    servers.push(server)
    expect(download).not.toHaveBeenCalled()
    expect(server.mode).toBe('source')
    vi.unstubAllGlobals()
    expect(await (await fetch(server.url)).text()).toContain('/@vite/client')
  })

  it('assembles identical light headers and immutable assets only from the committed source identity', async () => {
    const project = await fixture({
      'package.json': JSON.stringify({ version: packageVersion }),
      'dist/viewer/index.html': '<script></script>',
      'dist/viewer/THIRD_PARTY_NOTICES.txt': 'notices',
      'dist/viewer/viewer-build.json': '{"packages":[]}',
      '.gitignore': 'dist/\n.viewer-release-assets/\nviewer-release.json\n',
    })
    fixtures.push(project)
    await mkdir(join(project.root, 'scripts/viewer'), { recursive: true })
    for (const name of ['archive.mjs', 'assemble.mjs']) await cp(resolve(import.meta.dirname, '../scripts/viewer', name), join(project.root, 'scripts/viewer', name))
    const gitOptions = { cwd: project.root, env: { ...process.env, GIT_AUTHOR_NAME: 'Codegraph test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'Codegraph test', GIT_COMMITTER_EMAIL: 'test@example.test' } }
    await run('git', ['init', '--quiet'], gitOptions)
    await run('git', ['add', '.'], gitOptions)
    await run('git', ['commit', '--quiet', '-m', 'fixture release'], gitOptions)
    const sha = (await run('git', ['rev-parse', 'HEAD'], gitOptions)).stdout.trim()
    await run(process.execPath, ['scripts/viewer/assemble.mjs'], gitOptions)
    const header = JSON.parse(await readFile(join(project.root, 'viewer-release.json'), 'utf8'))
    expect(header).toMatchObject({ packageVersion, sourceRevision: sha, asset: `viewer-${sha}.tar.gz` })
    expect(await readFile(join(project.root, '.viewer-release-assets/viewer-release.json'))).toEqual(await readFile(join(project.root, 'viewer-release.json')))
    const archive = await readFile(join(project.root, '.viewer-release-assets', header.asset))
    expect(digest(archive)).toBe(header.compression.sha256)
    expect(digest(gunzipSync(archive))).toBe(header.sha256)
    await run(process.execPath, ['scripts/viewer/assemble.mjs'], gitOptions)
    expect(await readFile(join(project.root, '.viewer-release-assets', header.asset))).toEqual(archive)
    await expect(run(process.execPath, ['scripts/viewer/assemble.mjs'], { ...gitOptions, env: { ...gitOptions.env, SOURCE_REVISION: '0'.repeat(40) } })).rejects.toThrow('differs')
    await writeFile(join(project.root, 'package.json'), JSON.stringify({ version: '0.1.4' }))
    await expect(run(process.execPath, ['scripts/viewer/assemble.mjs'], gitOptions)).rejects.toThrow('inputs differ')
  })

  it('preserves deterministic bytes, fonts, diagrams, and original notices from the actual browser build', async () => {
    const item = await release(true)
    const again = await buildViewerArchive(builtAssets)
    expect(again.descriptor).toEqual(item.descriptor)
    expect(again.gzip).toEqual(item.gzip)
    expect(gunzipSync(item.gzip)).toEqual(item.tar)
    await writeFile(join(item.project.root, 'bundle.tar'), item.tar)
    const archive = await openViewerArchive(join(item.project.root, 'bundle.tar'), item.descriptor)
    archives.push(archive)
    const chunks = await readdir(join(builtAssets, 'assets'))
    const font = chunks.find((name) => name.endsWith('.woff2'))!
    const diagram = chunks.find((name) => name.includes('flowDiagram'))!
    expect(archive.bytes(`assets/${font}`)).toBeGreaterThan(0)
    expect(archive.bytes(`assets/${diagram}`)).toBeGreaterThan(0)
    const notices = await text(archive, 'THIRD_PARTY_NOTICES.txt')
    expect(notices).toContain('mermaid@')
    expect(notices).toContain('preact@')
    expect(notices).toContain('katex@')
    expect(notices).toContain('Copyright')
  })

  it('rejects symlinks and byte identity changes, and never follows a cache symlink', async () => {
    const item = await release()
    const path = join(item.project.root, 'bundle.tar')
    await writeFile(path, item.tar)
    await symlink(path, join(item.project.root, 'linked.tar'))
    await expect(openViewerArchive(join(item.project.root, 'linked.tar'), item.descriptor)).rejects.toThrow()
    await expect(openViewerArchive(path, { ...item.descriptor, sha256: '0'.repeat(64) })).rejects.toThrow('digest')
    await expect(openViewerArchive(path, { ...item.descriptor, bytes: item.tar.length + 512 })).rejects.toThrow('size')
    await symlink(join(item.project.root, 'assets/index.html'), join(item.project.root, 'assets/link'))
    await expect(buildViewerArchive(join(item.project.root, 'assets'))).rejects.toThrow('not a regular file')
  })

  it.each(['traversal', 'duplicate', 'link', 'oversize', 'checksum', 'terminator'] as const)('rejects an authenticated but malformed %s archive', async (kind) => {
    const item = await release()
    const tar = Buffer.from(item.tar)
    if (kind === 'traversal') { tar.fill(0, 0, 100); tar.write('../escape'); checksum(tar) }
    if (kind === 'duplicate') {
      const size = Number.parseInt(tar.toString('ascii', 124, 136), 8)
      const next = 512 + Math.ceil(size / 512) * 512
      tar.copy(tar, next, 0, 100)
      checksum(tar.subarray(next, next + 512))
    }
    if (kind === 'link') { tar[156] = 50; checksum(tar) }
    if (kind === 'oversize') { tar.write('77777777777\0', 124, 'ascii'); checksum(tar) }
    if (kind === 'checksum') tar[0] = tar[0]! ^ 1
    if (kind === 'terminator') tar[tar.length - 1] = 1
    const path = join(item.project.root, 'malformed.tar')
    await writeFile(path, tar)
    await expect(openViewerArchive(path, { bytes: tar.length, sha256: digest(tar) })).rejects.toThrow()
  })

  it('serves readonly assets while keeping catalogue edits, CAS, reconnects and disposal on the same authority', async () => {
    const item = await release(true)
    delivery(item.gzip)
    const archive = await acquire(item)
    // Restore actual HTTP fetch after the controlled release download.
    vi.unstubAllGlobals()
    const server = await startEmbeddedViewer({ root: join(item.project.root, 'domain'), port: 0, cache: false }, archive)
    servers.push(server)
    const htmlResponse = await fetch(server.url)
    const html = await htmlResponse.text()
    expect(htmlResponse.headers.get('cache-control')).toBe('no-store')
    const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1]!
    const code = await fetch(server.url + entry)
    expect(code.headers.get('cache-control')).toContain('immutable')
    expect((await code.text())).toContain(CATALOG_EVENTS_ENDPOINT)
    const head = await fetch(server.url + entry, { method: 'HEAD' })
    expect(Number(head.headers.get('content-length'))).toBe(archive.bytes(entry.slice(1)))
    expect(await head.text()).toBe('')
    expect((await fetch(server.url + '/@fs/etc/passwd')).status).toBe(403)
    expect((await fetch(server.url + '/assets/%2f..%2f..%2fpackage.json')).status).toBe(404)
    expect((await fetch(server.url + '/assets/%5c..%5cpackage.json')).status).toBe(404)
    const initial: CatalogBootstrap = await (await fetch(server.url + CATALOG_BOOTSTRAP_ENDPOINT)).json()
    const selected = initial.index.specs[0]!
    const payload: CatalogSpecPayload = await (await fetch(server.url + CATALOG_SPEC_ENDPOINT + '?' + new URLSearchParams({ source: selected.source, revision: selected.revision }))).json()
    const api = payload.spec.modules[0]!.api!
    const save = () => fetch(server.url + initial.adapterManifest.editing!.endpoint + '&' + new URLSearchParams({ source: api.source }), {
      method: 'PUT', headers: { [SOURCE_EDIT_HEADER]: '1', 'content-type': 'text/plain', 'if-match': `"${api.revision}"` }, body: api.text.replace('Alpha', 'Beta'),
    })
    expect((await save()).status).toBe(200)
    await expect.poll(async () => (await server.catalog()).generation, { timeout: 15_000 }).toBeGreaterThan(initial.generation)
    expect((await save()).status).toBe(409)
    const abort = new AbortController()
    const eventResponse = await fetch(server.url + CATALOG_EVENTS_ENDPOINT, { signal: abort.signal })
    const reader = eventResponse.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain(`data: ${(await server.catalog()).generation}`)
    await server.close()
    abort.abort()
    await reader.cancel().catch(() => undefined)
    expect(() => archive.stream('index.html')).toThrow('closed')
    await expect(fetch(server.url)).rejects.toThrow()
  })

  it('closes its transferred archive when project initialization fails and supports empty assets', async () => {
    const item = await release()
    delivery(item.gzip)
    const archive = await acquire(item)
    expect(await text(archive, 'assets/empty.txt')).toBe('')
    await expect(startEmbeddedViewer({ root: join(item.project.root, 'missing'), port: 0 }, archive)).rejects.toThrow()
    expect(() => archive.stream('index.html')).toThrow('closed')
  })

  it('cancels individual response reads without closing the shared inode, then drains reads before owner disposal', async () => {
    const item = await release(true)
    delivery(item.gzip)
    const archive = await acquire(item)
    const paths = await readdir(join(builtAssets, 'assets'))
    const path = 'assets/' + paths.find((name) => name.endsWith('.js'))!
    const cancelled = archive.stream(path)
    cancelled.once('data', () => cancelled.destroy())
    await finished(cancelled).catch(() => undefined)
    expect(await text(archive, 'index.html')).toContain('script')
    const active = archive.stream(path)
    active.resume()
    await archive.close()
    await finished(active).catch(() => undefined)
    expect(() => archive.stream(path)).toThrow('closed')
  })
})

function digest(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex') }
function checksum(header: Buffer) {
  header.fill(32, 148, 156)
  const sum = header.subarray(0, 512).reduce((result, byte) => result + byte, 0)
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
}

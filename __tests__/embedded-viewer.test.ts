import { readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startEmbeddedViewer } from '../server/embedded.ts'
import { createViewerWatcher } from '../server/file-watcher.ts'
import type { RunningDevServer } from '../server/start.ts'
import { CATALOG_BOOTSTRAP_ENDPOINT, CATALOG_EVENTS_ENDPOINT, type CatalogBootstrap } from '../viewer-host/live.ts'
import { CATALOG_SPEC_ENDPOINT, type CatalogSpecPayload } from '../viewer-host/catalog.ts'
import { SOURCE_EDIT_HEADER } from '../application/interaction/editing.ts'
import { fixture, type Fixture } from './fixture.ts'

const assets = resolve(import.meta.dirname, '../dist/viewer')
const fixtures: Fixture[] = []
const servers: RunningDevServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(fixtures.splice(0).map((item) => item.remove()))
})

async function open(files = { 'alpha/.spec/api.d.ts': 'export interface Alpha {}\n' }) {
  const project = await fixture(files)
  fixtures.push(project)
  const server = await startEmbeddedViewer({ root: project.root, port: 0, cache: false }, assets)
  servers.push(server)
  return { project, server }
}

async function bootstrap(server: RunningDevServer): Promise<CatalogBootstrap> {
  const response = await fetch(server.url + CATALOG_BOOTSTRAP_ENDPOINT)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  return response.json()
}

async function events(server: RunningDevServer) {
  const abort = new AbortController()
  const response = await fetch(server.url + CATALOG_EVENTS_ENDPOINT, { signal: abort.signal })
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const reader = response.body!.getReader()
  let buffer = ''
  return {
    async next(): Promise<number | undefined> {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const message = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const generation = message.match(/^data: (\d+)$/m)?.[1]
          if (generation) return Number(generation)
        } else {
          const chunk = await reader.read()
          if (chunk.done) return undefined
          buffer += new TextDecoder().decode(chunk.value)
        }
      }
    },
    async close() { abort.abort(); await reader.cancel().catch(() => undefined) },
  }
}

describe('embedded installed viewer', () => {
  it('serves the real compiled browser graph and its complete notices without filesystem routes', async () => {
    const { server } = await open()
    const html = await (await fetch(server.url)).text()
    const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
    expect(entry).toMatch(/^\/assets\/index-[\w-]+\.js$/)
    const entryResponse = await fetch(server.url + entry)
    expect(entryResponse.headers.get('content-type')).toContain('javascript')
    const code = await entryResponse.text()
    expect(code).toContain(CATALOG_BOOTSTRAP_ENDPOINT)
    expect(code).toContain(CATALOG_EVENTS_ENDPOINT)
    expect(code).not.toContain('virtual:spec-catalog-index')
    const notices = await (await fetch(server.url + '/THIRD_PARTY_NOTICES.txt')).text()
    expect(notices).toContain('mermaid@')
    expect(notices).toContain('preact@')
    expect(notices).toContain('katex@')
    expect(notices).toContain('Copyright')
    const build = JSON.parse(await readFile(join(assets, 'viewer-build.json'), 'utf8'))
    expect(build.packages.some((item: { name: string }) => item.name === '@codemirror/view')).toBe(true)
    const chunks = await readdir(join(assets, 'assets'))
    expect(chunks.some((name) => name.includes('flowDiagram'))).toBe(true)
    expect(chunks.some((name) => name.endsWith('.woff2'))).toBe(true)
    expect(chunks.some((name) => name.endsWith('.map'))).toBe(false)
    expect((await fetch(server.url + '/@fs/etc/passwd')).status).toBe(403)
    expect((await fetch(server.url + '/assets/%2f..%2f..%2fpackage.json')).status).toBe(404)
    expect((await fetch(server.url + '/assets/%5c..%5cpackage.json')).status).toBe(404)
    expect((await fetch(server.url + CATALOG_BOOTSTRAP_ENDPOINT, { headers: { origin: 'https://other.test' } })).status).toBe(403)
  })

  it('keeps source editing and snapshot/revision CAS attached to the same catalog authority', async () => {
    const { project, server } = await open()
    const initial = await bootstrap(server)
    expect(initial).toEqual(await server.catalog())
    const entry = initial.index.specs[0]!
    const payload: CatalogSpecPayload = await (await fetch(server.url + CATALOG_SPEC_ENDPOINT + '?' + new URLSearchParams({ source: entry.source, revision: entry.revision }))).json()
    const api = payload.spec.modules[0]!.api!
    const endpoint = initial.adapterManifest.editing!.endpoint
    const text = api.text.replace('Alpha', 'Beta')
    const save = () => fetch(server.url + endpoint + '&' + new URLSearchParams({ source: api.source }), {
      method: 'PUT',
      headers: { [SOURCE_EDIT_HEADER]: '1', 'content-type': 'text/plain', 'if-match': `"${api.revision}"` },
      body: text,
    })
    const response = await save()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'saved' })
    expect(await readFile(join(project.root, api.source), 'utf8')).toBe(text)
    await expect.poll(async () => (await bootstrap(server)).index.snapshot, { timeout: 15_000 }).not.toBe(initial.index.snapshot)
    expect((await save()).status).toBe(409)
    // A browser using the previous immutable payload can still finish rendering it.
    const retained = await fetch(server.url + CATALOG_SPEC_ENDPOINT + '?' + new URLSearchParams({ source: entry.source, revision: entry.revision }))
    expect(await retained.json()).toEqual(payload)
  })

  it('catches edits between bootstrap and SSE connection, reconnects, and module add/delete', async () => {
    const { project, server } = await open()
    const initial = await bootstrap(server)
    await project.write('alpha/.spec/api.d.ts', 'export interface Beta {}\n')
    await expect.poll(async () => (await bootstrap(server)).generation, { timeout: 15_000 }).toBeGreaterThan(initial.generation)
    const afterEdit = await bootstrap(server)
    const first = await events(server)
    try { expect(await first.next()).toBe(afterEdit.generation) } finally { await first.close() }
    await project.write('beta/.spec/api.d.ts', 'export interface Second {}\n')
    await expect.poll(async () => (await bootstrap(server)).index.specs.length, { timeout: 15_000 }).toBe(2)
    const afterAdd = await bootstrap(server)
    const reconnected = await events(server)
    try {
      expect(await reconnected.next()).toBe(afterAdd.generation)
      await rm(join(project.root, 'alpha'), { recursive: true })
      expect(await reconnected.next()).toBeGreaterThan(afterAdd.generation)
      const current = await bootstrap(server)
      expect(current.index.specs.map((entry) => entry.source)).toEqual(['beta/.spec/api.d.ts'])
      const fresh = await startEmbeddedViewer({ root: project.root, port: 0, cache: false }, assets)
      servers.push(fresh)
      const freshCatalog = await bootstrap(fresh)
      expect(current.index.specs).toEqual(freshCatalog.index.specs)
      expect(current.index.diagnostics).toEqual(freshCatalog.index.diagnostics)
    } finally { await reconnected.close() }
  })

  it('closes active streams and pending reloads, and makes disposal idempotent', async () => {
    const { project, server } = await open()
    const stream = await events(server)
    await stream.next()
    await project.write('alpha/.spec/api.d.ts', 'export interface Changed {}\n')
    const closing = server.close()
    expect(server.close()).toBe(closing)
    await closing
    await expect(server.catalog()).rejects.toThrow('closed')
    await stream.close()
    await expect(fetch(server.url)).rejects.toThrow()
  })

  it('prunes dependency/generated trees before creating watchers and never follows foreign symlinks', async () => {
    const current = await fixture({
      'alpha/.spec/api.d.ts': 'export interface Alpha {}',
      'node_modules/huge/deep/file.ts': '', 'dist/deep/file.ts': '',
      '.git/objects/deep/file': '', '.codegraph-cache/deep/file': '',
      'benchmark/artifacts/deep/file.ts': '',
    })
    const foreign = await fixture({ 'outside/deep/file.ts': '' })
    fixtures.push(current, foreign)
    await symlink(foreign.root, join(current.root, 'linked'))
    const watcher = createViewerWatcher(current.root)
    try {
      await new Promise<void>((ready, reject) => { watcher.once('ready', ready); watcher.once('error', reject) })
      const watched = Object.keys(watcher.getWatched())
      expect(watched.some((path) => path.endsWith('/alpha/.spec'))).toBe(true)
      expect(watched.some((path) => /\/(?:node_modules|dist|\.git|\.codegraph-cache|linked)(?:\/|$)/.test(path))).toBe(false)
      expect(watched.some((path) => path.includes('/benchmark/artifacts'))).toBe(false)
      expect(watched.some((path) => path.startsWith(foreign.root))).toBe(false)
    } finally { await watcher.close() }
  })
})

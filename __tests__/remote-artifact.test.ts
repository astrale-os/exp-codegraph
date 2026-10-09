import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DecisionProcess } from '../analysis/native/decision-session.ts'
import { materializeArtifact } from '../distribution/materialize.ts'
import { releaseArtifactURL } from '../distribution/model.ts'

const temporary: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const release = { packageVersion: '0.1.3', sourceRevision: '1'.repeat(40) }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-remote-artifact-'))
  temporary.push(root)
  const bytes = Buffer.from('qualified remote original\n'.repeat(10_000)), gzip = gzipSync(bytes)
  const artifact = { bytes: bytes.length, sha256: hash(bytes),
    compression: { format: 'gzip' as const, bytes: gzip.length, sha256: hash(gzip) } }
  const source = { release, asset: `native-darwin-arm64-${release.sourceRevision}.gz` }
  const options = { cacheRoot: join(root, 'cache'), cacheKey: `fixture-${artifact.sha256}`, executable: true }
  return { root, bytes, gzip, artifact, source, options,
    materialize: (signal?: AbortSignal) => materializeArtifact(source, artifact, { ...options, signal }) }
}

function response(bytes: Uint8Array | ReadableStream<Uint8Array>, url: string, status = 200) {
  const value = new Response(bytes, { status })
  Object.defineProperty(value, 'url', { value: url })
  return value
}

async function files(root: string) {
  try { return await readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

describe('source-bound remote artifact cache', () => {
  it('fetches the exact source URL lazily, publishes one executable and reuses it completely offline', async () => {
    const f = await fixture()
    const download = vi.fn(async (url: string) => response(f.gzip, url))
    vi.stubGlobal('fetch', download)
    const path = await f.materialize(), inode = (await lstat(path)).ino
    expect(await readFile(path)).toEqual(f.bytes)
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0]![0]).toBe(releaseArtifactURL(release, f.source.asset))
    expect((await lstat(path)).mode & 0o111).not.toBe(0)
    download.mockImplementation(async () => { throw new Error('offline') })
    expect(await f.materialize()).toBe(path)
    expect((await lstat(path)).ino).toBe(inode)
    expect(download).toHaveBeenCalledTimes(1)
    expect(await files(f.options.cacheRoot)).toEqual([basename(path)])
  })

  it('shares an uncancelled concurrent request without retaining an encoded copy', async () => {
    const f = await fixture()
    const download = vi.fn(async (url: string) => response(f.gzip, url))
    vi.stubGlobal('fetch', download)
    const paths = await Promise.all(Array.from({ length: 8 }, () => f.materialize()))
    expect(new Set(paths).size).toBe(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(await files(f.options.cacheRoot)).toEqual([basename(paths[0]!)])
  })

  it.skipIf(process.platform === 'win32')('repairs a corrupt inode while a pinned viewer reader retains its exact original', async () => {
    const f = await fixture()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(f.gzip, url)))
    const options = { ...f.options, executable: false, cacheKey: `viewer-${f.artifact.sha256}.tar` }
    const path = await materializeArtifact(f.source, f.artifact, options)
    const reader = await open(path, 'r')
    try {
      await rm(path); await writeFile(path, Buffer.alloc(f.bytes.length))
      expect(await materializeArtifact(f.source, f.artifact, options)).toBe(path)
      expect(await readFile(path)).toEqual(f.bytes)
      expect(await reader.readFile()).toEqual(f.bytes)
      expect(await files(options.cacheRoot)).toEqual([basename(path)])
    } finally { await reader.close() }
  })

  it.each(['encoded-size', 'encoded-sha', 'decoded-size', 'decoded-sha', 'truncated'] as const)(
    'rejects %s and recovers on the next call without poisoning the cache', async (kind) => {
      const f = await fixture(), bad = structuredClone(f.artifact)
      if (kind === 'encoded-size') bad.compression.bytes--
      if (kind === 'encoded-sha') bad.compression.sha256 = '0'.repeat(64)
      if (kind === 'decoded-size') bad.bytes--
      if (kind === 'decoded-sha') bad.sha256 = '0'.repeat(64)
      const encoded = kind === 'truncated' ? f.gzip.subarray(0, f.gzip.length - 8) : f.gzip
      if (kind === 'truncated') bad.compression = { ...bad.compression, bytes: encoded.length, sha256: hash(encoded) }
      vi.stubGlobal('fetch', vi.fn(async (url: string) => response(encoded, url)))
      const options = { ...f.options, cacheKey: `fixture-${bad.sha256}` }
      await expect(materializeArtifact(f.source, bad, options)).rejects.toMatchObject({
        code: kind === 'truncated' ? 'ARTIFACT_INVALID' : 'ARTIFACT_DIGEST_MISMATCH',
      })
      expect(await files(f.options.cacheRoot)).toEqual([])
      vi.stubGlobal('fetch', vi.fn(async (url: string) => response(f.gzip, url)))
      expect(await readFile(await f.materialize())).toEqual(f.bytes)
    },
  )

  it('reports unavailable release/network without publishing placeholders, then retries normally', async () => {
    const f = await fixture(), download = vi.fn(async (url: string) => response(new Uint8Array(), url, 404))
    vi.stubGlobal('fetch', download)
    await expect(f.materialize()).rejects.toMatchObject({ code: 'ARTIFACT_DOWNLOAD_FAILED' })
    expect(await files(f.options.cacheRoot)).toEqual([])
    download.mockImplementation(async (url: string) => response(f.gzip, url))
    expect(await readFile(await f.materialize())).toEqual(f.bytes)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('cancels a stalled transfer without cancelling a second consumer and cleans only its staging', async () => {
    const f = await fixture(), controller = new AbortController()
    await mkdir(f.options.cacheRoot)
    await writeFile(join(f.options.cacheRoot, '.other-request.tmp'), 'not ours')
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const download = vi.fn(async (url: string, init?: RequestInit) => {
      if (download.mock.calls.length !== 1) return response(f.gzip, url)
      return response(new ReadableStream({ start(stream) {
        stream.enqueue(f.gzip.subarray(0, 8)); started()
        init!.signal!.addEventListener('abort', () => stream.error(init!.signal!.reason), { once: true })
      } }), url)
    })
    vi.stubGlobal('fetch', download)
    const first = f.materialize(controller.signal)
    const rejected = expect(first).rejects.toThrow('cancel first consumer')
    await ready
    const second = f.materialize()
    controller.abort(new Error('cancel first consumer'))
    await rejected
    const path = await second
    expect(await readFile(path)).toEqual(f.bytes)
    expect(await readFile(join(f.options.cacheRoot, '.other-request.tmp'), 'utf8')).toBe('not ours')
    expect((await files(f.options.cacheRoot)).sort()).toEqual(['.other-request.tmp', basename(path)].sort())
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('session disposal cancels its actual artifact stream and awaits staging cleanup without late worker admission', async () => {
    const f = await fixture()
    let started!: () => void, closed = false
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => response(new ReadableStream({ start(stream) {
      stream.enqueue(f.gzip.subarray(0, 8)); started()
      init.signal!.addEventListener('abort', () => { closed = true; stream.error(init.signal!.reason) }, { once: true })
    } }), url)))
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import {createInterface} from 'node:readline';
      console.log(JSON.stringify({service:'astrale.lint-decision',protocol:1,contractRevision:1}));
      createInterface({input:process.stdin}).on('line',()=>process.exit(99));`], { stdio: 'pipe' })
    const transport = new DecisionProcess(child, (signal) => f.materialize(signal))
    try {
      await transport.ready()
      const transfer = transport.captureOwnedGeneric({ token: 'closing', configPath: '/config', config: {}, commandIgnorePatterns: [] })
      const failure = expect(transfer).rejects.toMatchObject({ code: 'PROCESS' })
      await ready
      await transport.dispose(); await failure
      expect(closed).toBe(true)
      expect(await files(f.options.cacheRoot)).toEqual([])
      expect(child.exitCode).not.toBe(99)
    } finally { await transport.dispose() }
  })

  it('rejects pre-aborted transfers before touching network or cache', async () => {
    const f = await fixture(), controller = new AbortController(), download = vi.fn()
    controller.abort(new Error('pre aborted')); vi.stubGlobal('fetch', download)
    await expect(f.materialize(controller.signal)).rejects.toThrow('pre aborted')
    expect(download).not.toHaveBeenCalled()
    expect(await files(f.options.cacheRoot)).toEqual([])
  })

  it('rejects a malformed remote authority even when the original content is already cached', async () => {
    const f = await fixture(), download = vi.fn(async (url: string) => response(f.gzip, url))
    vi.stubGlobal('fetch', download)
    await f.materialize()
    await expect(materializeArtifact({ ...f.source, asset: '../escape' }, f.artifact, f.options)).rejects.toMatchObject({ code: 'ARTIFACT_INVALID' })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('admits source-bound prerelease and build version names without allowing path syntax', () => {
    expect(releaseArtifactURL({ ...release, packageVersion: '0.1.3-beta.1+build.2' }, 'asset.gz'))
      .toContain('/codegraph-v0.1.3-beta.1+build.2-')
    expect(() => releaseArtifactURL({ ...release, packageVersion: '0.1.3/evil' }, 'asset.gz')).toThrow('Invalid source-bound')
  })

  it.each(['../escape', '/absolute', 'native\\windows.gz', 'https://another.host/file', 'latest/asset'])(
    'rejects non-basename release assets: %s', (asset) => {
      expect(() => releaseArtifactURL(release, asset)).toThrow('Invalid source-bound')
    },
  )
})

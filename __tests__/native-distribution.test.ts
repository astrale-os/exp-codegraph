import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

import {
  NativeAnalysisDistributionError,
  resolvePackagedNativeAnalysis,
} from '../analysis/typescript/distribution/index.ts'
import { NATIVE_TARGETS } from '../scripts/native/shared.mjs'

const packageRoot = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  .version as string
const target = `${process.platform}-${process.arch}`
const targets = Object.keys(NATIVE_TARGETS)
const workerSupported = NATIVE_TARGETS[target]?.oxlint === true

describe('native analysis distribution', () => {
  it('admits an explicit application-controlled executable without ttsc or a release artifact', async () => {
    await withDirectory('codegraph-explicit-native-', async (root) => {
      const binary = join(root, 'native')
      const content = Buffer.from('qualified explicit native fixture\n')
      await writeFile(binary, content)
      await chmod(binary, 0o755)

      await expect(resolvePackagedNativeAnalysis({ binary })).resolves.toEqual({
        command: binary,
        origin: 'explicit',
        target,
        packageVersion,
        bytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
      })
    })
  })

  it('fails closed on a target the release does not deliver', async () => {
    await withPackagedFixture({ released: false }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({
        code: 'NATIVE_TARGET_UNSUPPORTED',
        target,
      })
    })
  }, 30_000)

  it('fails closed when the released executable is absent from the package', async () => {
    await withPackagedFixture({ install: false }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({
        code: 'NATIVE_ARTIFACT_INVALID',
        target,
      })
    })
  }, 30_000)

  it('admits the executable delivered inside the package', async () => {
    await withPackagedFixture({}, async (fixture) => {
      await expect(fixture.resolve()).resolves.toMatchObject({
        command: fixture.binary,
        origin: 'package',
        target,
        packageVersion,
      })
    })
  }, 30_000)

  it('materializes compressed Go through the existing public resolver without writing into its package', async () => {
    await withPackagedFixture({ compressed: true }, async (fixture) => {
      const first = await fixture.resolve() as { command: string; sha256: string; bytes: number }
      try {
        expect(first).toMatchObject({ origin: 'package', target, packageVersion })
        expect(first.command).not.toBe(fixture.binary)
        expect(await fixture.resolve()).toEqual(first)
        const original = await readFile(first.command)
        expect(original.length).toBe(first.bytes)
        expect(createHash('sha256').update(original).digest('hex')).toBe(first.sha256)
        await expect(readFile(fixture.binary)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally { await rm(first.command, { force: true }) }
    })
  }, 30_000)

  it.runIf(workerSupported)('materializes the compressed companion independently through its public resolver', async () => {
    await withPackagedFixture({ compressed: true, oxlint: true }, async (fixture) => {
      const worker = await fixture.resolveOxlint() as { command: string; sha256: string }
      try {
        expect(worker).toMatchObject({ origin: 'package', engineVersion: '1.81.0', protocolVersion: 1 })
        expect(worker.command).not.toBe(fixture.worker)
        expect(createHash('sha256').update(await readFile(worker.command)).digest('hex')).toBe(worker.sha256)
      } finally { await rm(worker.command, { force: true }) }
    })
  }, 30_000)

  it.runIf(workerSupported)('admits the package-bound worker independently of the Go analyzer', async () => {
    await withPackagedFixture({ oxlint: true }, async (fixture) => {
      await expect(fixture.resolve()).resolves.toMatchObject({ command: fixture.binary, origin: 'package' })
      await expect(fixture.resolveOxlint()).resolves.toMatchObject({
        command: fixture.worker, origin: 'package', target, packageVersion,
        engineVersion: '1.81.0', protocolVersion: 1,
        source: { revision: '3'.repeat(40), patchSha256: '4'.repeat(64) },
      })
      await expect(fixture.resolveOptionalOxlint()).resolves.toMatchObject({ command: fixture.worker })
    })
  }, 30_000)

  for (const workerFailure of ['missing', 'bytes', 'descriptor'] as const) {
    it.runIf(workerSupported)(`keeps Go usable while independently rejecting ${workerFailure} worker authority`, async () => {
      await withPackagedFixture({ oxlint: true, workerFailure }, async (fixture) => {
        await expect(fixture.resolve()).resolves.toMatchObject({ command: fixture.binary, origin: 'package' })
        await expect(fixture.resolveOxlint()).rejects.toMatchObject({
          code: workerFailure === 'bytes' ? 'NATIVE_ARTIFACT_DIGEST_MISMATCH' : 'NATIVE_ARTIFACT_INVALID',
        })
        await expect(fixture.resolveOptionalOxlint()).rejects.toMatchObject({
          code: workerFailure === 'bytes' ? 'NATIVE_ARTIFACT_DIGEST_MISMATCH' : 'NATIVE_ARTIFACT_INVALID',
        })
      })
    }, 30_000)
  }

  it('fetches only the source-bound current-host Go capability from a binary-free package and preloads offline', async () => {
    await withPackagedFixture({ compressed: true, remote: true, oxlint: workerSupported }, async (fixture) => {
      const first = await fixture.preload() as { analysis: { command: string }; generic?: unknown }
      try {
        expect(first).toMatchObject({ analysis: { origin: 'package', target, packageVersion } })
        expect(first.generic).toBeUndefined()
        expect(fixture.downloads).toEqual([`native-${target}-${'1'.repeat(40)}.gz`])
        await expect(readFile(fixture.binary)).rejects.toMatchObject({ code: 'ENOENT' })
        fixture.offline()
        expect(await fixture.preload()).toEqual(first)
        expect(fixture.downloads).toHaveLength(1)
      } finally { await rm(first.analysis.command, { force: true }) }
    })
  }, 30_000)

  it.runIf(workerSupported)('preloads the independent remote worker only when requested and preserves healthy offline recovery', async () => {
    await withPackagedFixture({ compressed: true, remote: true, oxlint: true }, async (fixture) => {
      const first = await fixture.preload({ generic: true }) as { analysis: { command: string }; generic: { command: string } }
      try {
        expect(first.generic).toMatchObject({ origin: 'package', engineVersion: '1.81.0', protocolVersion: 1 })
        expect(fixture.downloads).toEqual([`native-${target}-${'1'.repeat(40)}.gz`, `oxlint-${target}-${'1'.repeat(40)}.gz`])
        fixture.offline()
        expect(await fixture.preload({ generic: true })).toEqual(first)
        expect(fixture.downloads).toHaveLength(2)
      } finally { await Promise.all([first.analysis.command, first.generic.command].map((path) => rm(path, { force: true }))) }
    })
  }, 30_000)

  it.runIf(workerSupported)('does not invalidate remote Go when a companion refers to a different source', async () => {
    await withPackagedFixture({ compressed: true, remote: true, oxlint: true, remoteWorkerMismatch: true }, async (fixture) => {
      const go = await fixture.resolve() as { command: string }
      try {
        await expect(fixture.resolveOxlint()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
        expect(fixture.downloads).toEqual([`native-${target}-${'1'.repeat(40)}.gz`])
      } finally { await rm(go.command, { force: true }) }
    })
  }, 30_000)

  it('rejects a remote Go descriptor from a different source before touching the network', async () => {
    await withPackagedFixture({ compressed: true, remote: true, remoteGoMismatch: true }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({ code: 'NATIVE_RELEASE_MANIFEST_INVALID' })
      expect(fixture.downloads).toEqual([])
    })
  }, 30_000)

  it('keeps absent remote generic capability honestly unavailable when explicitly preloading it', async () => {
    await withPackagedFixture({ compressed: true, remote: true }, async (fixture) => {
      const go = await fixture.resolve() as { command: string }
      try {
        await expect(fixture.preload({ generic: true })).rejects.toMatchObject({ code: 'NATIVE_OXLINT_UNAVAILABLE' })
        expect(fixture.downloads).toEqual([`native-${target}-${'1'.repeat(40)}.gz`])
      } finally { await rm(go.command, { force: true }) }
    })
  }, 30_000)

  it('keeps historical Go-only releases usable without admitting a worker', async () => {
    await withPackagedFixture({}, async (fixture) => {
      await expect(fixture.resolve()).resolves.toMatchObject({ origin: 'package' })
      await expect(fixture.resolveOxlint()).rejects.toMatchObject({ code: 'NATIVE_OXLINT_UNAVAILABLE' })
      await expect(fixture.resolveOptionalOxlint()).resolves.toBeUndefined()
    })
  }, 30_000)

  it.runIf(!workerSupported)('keeps a Go-only host usable and rejects even an unexpected worker descriptor', async () => {
    await withPackagedFixture({ oxlint: true }, async (fixture) => {
      await expect(fixture.resolve()).resolves.toMatchObject({ origin: 'package' })
      await expect(fixture.resolveOxlint()).rejects.toMatchObject({ code: 'NATIVE_OXLINT_UNAVAILABLE', target })
      await expect(fixture.resolveOptionalOxlint()).resolves.toBeUndefined()
    })
  }, 30_000)

  it.each([false, true])('rejects an artifact directory symlink escaping package authority (compressed=%s)', async (compressed) => {
    await withPackagedFixture({ compressed, escapingDirectory: true }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
    })
  }, 30_000)

  it('rejects executable digest drift', async () => {
    await withPackagedFixture({ corruptDigest: true }, async (digest) => {
      await expect(digest.resolve()).rejects.toMatchObject({
        code: 'NATIVE_ARTIFACT_DIGEST_MISMATCH',
      })
    })
  }, 30_000)

  it('rejects an executable symlink escaping its artifact directory', async () => {
    await withPackagedFixture({ escapingSymlink: true }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
    })
  }, 30_000)

  it.skipIf(process.platform === 'win32')('rejects a non-executable explicit file', async () => {
    await withDirectory('codegraph-non-executable-native-', async (root) => {
      const binary = join(root, 'native')
      await writeFile(binary, 'not executable\n')
      await chmod(binary, 0o644)
      await expect(resolvePackagedNativeAnalysis({ binary })).rejects.toEqual(
        expect.objectContaining({
          code: 'NATIVE_ARTIFACT_NOT_EXECUTABLE',
        } satisfies Partial<NativeAnalysisDistributionError>),
      )
    })
  })
})

interface PackagedFixture {
  readonly binary: string
  readonly worker: string
  resolve(): Promise<unknown>
  resolveOxlint(): Promise<unknown>
  resolveOptionalOxlint(): Promise<unknown>
  preload(options?: { generic?: boolean }): Promise<unknown>
  readonly downloads: string[]
  offline(): void
}

// Copying and importing a complete distribution is qualification setup, not a
// five-second resolver performance assertion. Each fixture owns its whole async
// lifetime: a runner timeout cannot remove files while cp is still creating them.
async function withPackagedFixture(options: {
  readonly compressed?: boolean
  readonly remote?: boolean
  readonly remoteWorkerMismatch?: boolean
  readonly remoteGoMismatch?: boolean
  readonly released?: boolean
  readonly install?: boolean
  readonly corruptDigest?: boolean
  readonly escapingDirectory?: boolean
  readonly escapingSymlink?: boolean
  readonly oxlint?: boolean
  readonly workerFailure?: 'missing' | 'bytes' | 'descriptor'
}, check: (fixture: PackagedFixture) => Promise<void>): Promise<void> {
  await withDirectory('codegraph-packaged-native-', async (root) => {
    try { await check(await packagedFixture(root, options)) }
    finally { vi.unstubAllGlobals(); if (options.escapingDirectory) await rm(`${root}-foreign`, { recursive: true, force: true }) }
  })
}

async function packagedFixture(root: string, options: Parameters<typeof withPackagedFixture>[0]): Promise<PackagedFixture> {
  await cp(join(packageRoot, 'dist'), join(root, 'dist'), {
    recursive: true,
    filter: (source) => !source.endsWith('.js.map'),
  })
  await stripSourceMapComments(join(root, 'dist'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@astrale-os/codegraph', version: packageVersion, type: 'module' }),
  )
  if (!targets.includes(target)) throw new Error(`Unsupported native distribution test target ${target}.`)
  const executable = NATIVE_TARGETS[target]!.executable
  const artifactDirectory = join(root, 'native-artifacts', target)
  const binary = join(artifactDirectory, executable)
  const outside = join(root, 'outside')
  const bytes = Buffer.from(options.compressed ? `packaged native fixture ${root}\n` : 'packaged native fixture\n')
  const workerBytes = Buffer.from(options.compressed ? `packaged worker fixture ${root}\n` : 'packaged worker admission fixture\n')
  const workerExecutable = 'bin/codegraph-oxlint'
  const worker = join(artifactDirectory, workerExecutable)
  await mkdir(dirname(binary), { recursive: true })
  if (options.escapingSymlink) {
    await writeFile(outside, bytes)
    await chmod(outside, 0o755)
    await symlink(outside, binary)
  } else if (options.install !== false) {
    await writeFile(binary, bytes)
    await chmod(binary, 0o755)
  }
  if (options.oxlint && options.workerFailure !== 'missing') {
    await writeFile(worker, options.workerFailure === 'bytes' ? 'corrupt worker' : workerBytes)
    await chmod(worker, 0o755)
  }
  const artifact = {
    target,
    executable,
    bytes: bytes.byteLength,
    sha256: options.corruptDigest
      ? '0'.repeat(64)
      : createHash('sha256').update(bytes).digest('hex'),
    ...(options.oxlint ? { oxlint: {
      executable: workerExecutable, bytes: workerBytes.length,
      sha256: createHash('sha256').update(workerBytes).digest('hex'),
      engineVersion: options.workerFailure === 'descriptor' ? '1.78.0' : '1.81.0', protocolVersion: 1,
      source: { revision: '3'.repeat(40), patchSha256: '4'.repeat(64) },
    } } : {}),
  }
  const downloads: string[] = [], remoteAssets = new Map<string, Buffer>()
  let offline = false
  if (options.compressed) {
    for (const delivered of [artifact, ...(options.oxlint ? [artifact.oxlint!] : [])]) {
      const original = join(artifactDirectory, delivered.executable)
      const encoded = gzipSync(await readFile(original))
      const source = options.remoteGoMismatch && delivered === artifact || options.remoteWorkerMismatch && delivered !== artifact ? '2' : '1'
      const asset = options.remote ? `${delivered === artifact ? 'native' : 'oxlint'}-${target}-${source.repeat(40)}.gz` : `${delivered.executable}.gz`
      Object.assign(delivered, { compression: { format: 'gzip', path: asset,
        bytes: encoded.length, sha256: createHash('sha256').update(encoded).digest('hex') } })
      if (options.remote) remoteAssets.set(asset, encoded)
      else await writeFile(`${original}.gz`, encoded)
      await rm(original)
    }
  }
  if (options.remote) {
    await rm(join(root, 'native-artifacts'), { recursive: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (offline) throw new Error('offline remote fixture')
      const expected = `https://github.com/astrale-os/exp-codegraph/releases/download/codegraph-v${packageVersion}-${'1'.repeat(40)}/`
      expect(url.startsWith(expected)).toBe(true)
      const asset = url.slice(expected.length), bytes = remoteAssets.get(asset)
      downloads.push(asset)
      const response = new Response(bytes ?? '', { status: bytes ? 200 : 404 })
      Object.defineProperty(response, 'url', { value: url })
      return response
    }))
  }
  await writeFile(
    join(root, 'native-release.json'),
    JSON.stringify({
      format: 'astrale.codegraph.native-release',
      version: 1,
      packageVersion,
      protocolVersion: 1,
      sourceRevision: '1'.repeat(40),
      ...(options.remote ? { delivery: 'github-release' } : {}),
      toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture' },
      artifacts: options.released === false ? {} : { [target]: artifact },
    }),
  )
  if (options.escapingDirectory) {
    const outsideDirectory = `${root}-foreign`
    const { rename } = await import('node:fs/promises')
    await rename(artifactDirectory, outsideDirectory)
    await symlink(outsideDirectory, artifactDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const module = await import(
    `${pathToFileURL(join(root, 'dist/analysis/typescript/distribution/index.js')).href}?fixture=${Date.now()}-${Math.random()}`
  ) as { resolvePackagedNativeAnalysis(): Promise<unknown>; resolvePackagedNativeOxlint(): Promise<unknown>; preloadNativeArtifacts(options?: { generic?: boolean }): Promise<unknown> }
  const internal = await import(
    pathToFileURL(join(root, 'dist/analysis/typescript/distribution/resolve.js')).href
  ) as { resolveOptionalPackagedNativeOxlint(): Promise<unknown> }
  expect('resolveOptionalPackagedNativeOxlint' in module).toBe(false)
  const canonical = await import('node:fs/promises')
  return { binary: options.install === false || options.compressed ? binary : await canonical.realpath(binary),
    worker: options.oxlint && !options.compressed && options.workerFailure !== 'missing' ? await canonical.realpath(worker) : worker,
    resolve: module.resolvePackagedNativeAnalysis, resolveOxlint: module.resolvePackagedNativeOxlint,
    resolveOptionalOxlint: internal.resolveOptionalPackagedNativeOxlint, preload: module.preloadNativeArtifacts, downloads, offline: () => { offline = true } }
}

async function withDirectory(prefix: string, use: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try { await use(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function stripSourceMapComments(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await stripSourceMapComments(path)
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = await readFile(path, 'utf8')
      await writeFile(path, source.replace(/\n\/\/# sourceMappingURL=.*\n?$/u, '\n'))
    }
  }
}

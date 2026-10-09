import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzipSync, gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

import {
  admitExternalReleaseAssets, admitPublishedReleaseAssets, admitQualificationRun, admitRegistryVersion, admitReleasePackage, assertNpmConsumerLock,
} from '../scripts/native/admit-packages.mjs'
import { assertArtifact, assertOxlintArtifact, NATIVE_TARGETS, nativeReleaseAssetName, oxlintExecutable, stableJson } from '../scripts/native/shared.mjs'

import { runInstalledNode } from '../qualification/v2/release/installed-node.mjs'

const execFile = promisify(execFileCallback)
const temporary: string[] = []
const version = '0.1.0'
const revision = '1'.repeat(40)
const repository = 'astrale-os/exp-codegraph'
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('qualified release archive admission', () => {
  it('binds the one real archive and every native executable to the qualified source', async () => {
    const directory = await releaseFixture()
    const release = await admitReleasePackage(directory, revision, version)
    expect(release.package.name).toBe('@astrale-os/codegraph')
    expect(release.package.integrity.startsWith('sha512-')).toBe(true)
    expect(release.tarballs).toEqual({ '.': release.package.archive })
    await expect(admitReleasePackage(directory, '2'.repeat(40), version)).rejects.toThrow('source revision')
  })

  it('admits gzip storage while binding every decoded executable to its original identity', async () => {
    const release = await admitReleasePackage(await releaseFixture(undefined, true), revision, version)
    expect(release.package.name).toBe('@astrale-os/codegraph')
  })

  it.each(['binary', 'oxlint', 'stray', 'second-archive'] as const)('rejects torn compressed %s publication', async (kind) => {
    await expect(admitReleasePackage(await releaseFixture(kind, true), revision, version)).rejects.toThrow()
  })

  it.each(['binary', 'dependency', 'version', 'oxlint', 'missing-oxlint', 'oxlint-source', 'notices', 'stray', 'second-archive'] as const)('rejects a torn %s publication before publishing', async (corruption) => {
    await expect(admitReleasePackage(await releaseFixture(corruption), revision, version)).rejects.toThrow()
  })

  it('reads historical Go-only artifacts but requires a worker for a new release', () => {
    const target = 'darwin-arm64'
    const artifact = { target, executable: NATIVE_TARGETS[target].executable, bytes: 1, sha256: '0'.repeat(64) }
    expect(() => assertArtifact(artifact, target, version)).not.toThrow()
    expect(() => assertArtifact(artifact, target, version, { requireOxlint: true })).toThrow('no qualified')
  })

  it.each(Object.keys(NATIVE_TARGETS).filter((target) => NATIVE_TARGETS[target]!.oxlint))('binds the worker filename, engine, protocol and source for %s', (target) => {
    const descriptor = oxlintDescriptor(target, Buffer.from('schema fixture'))
    expect(() => assertOxlintArtifact(descriptor, target)).not.toThrow()
    for (const changed of [
      { executable: '../codegraph-oxlint' }, { executable: 'bin/captured-owned-oxlint-1.81.0' },
      { bytes: 0 }, { sha256: 'invalid' }, { engineVersion: '1.78.0' }, { protocolVersion: 2 },
      { source: { ...descriptor.source, revision: 'main' } },
      { source: { ...descriptor.source, patchSha256: 'invalid' } },
    ]) expect(() => assertOxlintArtifact({ ...descriptor, ...changed }, target)).toThrow()
  })

  it.each(Object.keys(NATIVE_TARGETS).filter((target) => !NATIVE_TARGETS[target]!.oxlint))('admits Go without Rust but rejects an unqualified worker for %s', (target) => {
    const artifact = { target, executable: NATIVE_TARGETS[target]!.executable, bytes: 1, sha256: '0'.repeat(64) }
    expect(() => assertArtifact(artifact, target, version)).not.toThrow()
    expect(() => assertArtifact({ ...artifact, oxlint: { executable: 'bin/codegraph-oxlint' } }, target, version)).toThrow()
  })

  it('requires successful main qualification from the exact workflow, repository and revision', () => {
    const run = {
      repository: { full_name: repository }, head_repository: { full_name: repository },
      head_sha: revision, head_branch: 'main', path: '.github/workflows/native-release.yml',
      event: 'push', status: 'completed', conclusion: 'success',
    }
    expect(() => admitQualificationRun(run, revision, repository)).not.toThrow()
    for (const changed of [
      { event: 'pull_request' }, { conclusion: 'failure' }, { head_sha: '2'.repeat(40) },
      { head_repository: { full_name: 'other/fork' } }, { path: '.github/workflows/ci.yml' },
    ]) expect(() => admitQualificationRun({ ...run, ...changed }, revision, repository)).toThrow()
  })

  it('resumes only byte-identical npm versions and keeps missing versions explicit', async () => {
    const unit = { name: '@astrale-os/codegraph', version, integrity: 'sha512-qualified' }
    const metadata = (integrity: string) => new Response(JSON.stringify({
      name: unit.name, version, dist: {
        integrity, tarball: 'https://registry.npmjs.org/@astrale-os/codegraph/-/codegraph-0.1.0.tgz',
      },
    }))
    await expect(admitRegistryVersion(unit, { allowMissing: true, fetcher: async () => new Response('', { status: 404 }) })).resolves.toBeUndefined()
    await expect(admitRegistryVersion(unit, { allowMissing: false, fetcher: async () => new Response('', { status: 404 }) })).rejects.toThrow('HTTP 404')
    await expect(admitRegistryVersion(unit, { allowMissing: true, fetcher: async () => metadata('sha512-other') })).rejects.toThrow('immutable bytes')
    await expect(admitRegistryVersion(unit, { allowMissing: false, fetcher: async () => metadata('sha512-qualified') })).resolves.toBeUndefined()
  })

  it('rejects local and alternate-registry closure masquerading as npm qualification', () => {
    expect(() => assertNpmConsumerLock('resolution: {integrity: sha512-qualified}\n')).not.toThrow()
    for (const lock of [
      'version: file:../codegraph.tgz', 'version: link:../codegraph', 'specifier: workspace:*',
      'overrides: {}', 'resolution: {tarball: https://npm.pkg.github.com/package.tgz}',
      'resolution: {tarball: https://other.invalid/package.tgz}',
    ]) expect(() => assertNpmConsumerLock(lock)).toThrow()
  })
})

describe('installed consumer runtime isolation', () => {
  it('never inherits source-harness Node loaders or NODE_OPTIONS into a real product child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-installed-node-'))
    temporary.push(root)
    const child = join(root, 'runtime.mjs')
    await writeFile(child, 'process.stdout.write(JSON.stringify({ arguments: process.execArgv, nodeOptions: process.env.NODE_OPTIONS }))')
    const previous = process.env.NODE_OPTIONS
    try {
      process.env.NODE_OPTIONS = '--experimental-strip-types'
      const result = await runInstalledNode([child], { cwd: root })
      expect(JSON.parse(result.stdout)).toEqual({ arguments: [], nodeOptions: '' })
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = previous
    }
  })
})

describe('external release asset admission', () => {
  it('binds the light package, ten flat assets and anonymous URLs to the same source', async () => {
    const fixture = await remoteFixture()
    const admitted = await admitReleasePackage(fixture.directory, revision, version)
    const local = await admitExternalReleaseAssets({ directory: fixture.assets, sourceRevision: revision,
      packageVersion: version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })
    expect(local).toHaveLength(10)
    await expect(admitExternalReleaseAssets({ directory: fixture.assets, sourceRevision: revision,
      packageVersion: version, native: admitted.native, viewer: admitted.viewer })).resolves.toHaveLength(10)
    expect(local.map((asset) => asset.name).sort()).toEqual(Object.keys(fixture.payloads).sort())
    const requested: string[] = []
    const remote = await admitPublishedReleaseAssets(admitted, { fetcher: async (url, options) => {
      requested.push(String(url))
      expect(Object.keys(options)).toEqual(['signal'])
      return new Response(fixture.payloads[String(url).split('/').at(-1)!])
    } })
    expect(remote).toHaveLength(10)
    expect(requested.every((url) => url.startsWith(`https://github.com/${repository}/releases/download/codegraph-v${version}-${revision}/`))).toBe(true)
  })

  it('selects filenames from canonical paths rather than unrelated descriptor properties', async () => {
    const fixture = await remoteFixture()
    const admitted = await admitReleasePackage(fixture.directory, revision, version)
    admitted.native.artifacts['darwin-arm64'].compression.name = 'unqualified.gz'
    const header = Buffer.from(stableJson(admitted.native))
    await writeFile(join(fixture.assets, 'native-release.json'), header)
    admitted.headers.native = { bytes: header.length, sha256: digest(header), name: 'unqualified.json' }
    const assets = await admitExternalReleaseAssets({ directory: fixture.assets, sourceRevision: revision,
      packageVersion: version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })
    expect(assets.map((asset) => asset.name).sort()).toEqual(Object.keys(fixture.payloads).sort())
  })

  it.each(['native-artifacts/linux-x64/bin/unqualified', 'dist/viewer/index.html', '.native-release-assets/unqualified.gz', '.viewer-release-assets/unqualified.gz'])('rejects embedded payload %s', async (path) => {
    const fixture = await remoteFixture({ [path]: Buffer.from('unqualified') })
    await expect(admitReleasePackage(fixture.directory, revision, version)).rejects.toThrow('must not embed')
  })

  it.each(['source', 'path', 'viewer-source', 'worker-source'] as const)('rejects torn header %s', async (kind) => {
    const fixture = await remoteFixture({}, kind)
    await expect(admitReleasePackage(fixture.directory, revision, version)).rejects.toThrow()
  })

  it.each(['stray', 'missing', 'symlink', 'directory', 'encoded', 'decoded', 'header'] as const)('rejects external %s corruption before publication', async (kind) => {
    const fixture = await remoteFixture()
    const admitted = await admitReleasePackage(fixture.directory, revision, version)
    const name = Object.keys(fixture.payloads).find((path) => path.startsWith('native-'))!
    const path = join(fixture.assets, name)
    if (kind === 'stray') await writeFile(join(fixture.assets, 'stray'), 'unqualified')
    else if (kind === 'missing') await rm(path)
    else if (kind === 'symlink') { await rm(path); await symlink(join(fixture.assets, 'native-release.json'), path) }
    else if (kind === 'directory') { await rm(path); await mkdir(path) }
    else if (kind === 'header') await writeFile(join(fixture.assets, 'viewer-release.json'), JSON.stringify(admitted.viewer))
    else {
      const bytes = kind === 'encoded' ? Buffer.from(fixture.payloads[name]!) : gzipSync(Buffer.from('different decoded bytes'))
      if (kind === 'encoded') bytes[0] = bytes[0]! ^ 1
      await writeFile(path, bytes)
      if (kind === 'decoded') {
        const artifact = admitted.native.artifacts['darwin-arm64']
        artifact.compression.bytes = bytes.length
        artifact.compression.sha256 = digest(bytes)
        // The header identity changes honestly; original executable identity must still reject.
        const header = Buffer.from(stableJson(admitted.native))
        await writeFile(join(fixture.assets, 'native-release.json'), header)
        admitted.headers.native = { bytes: header.length, sha256: digest(header) }
      }
    }
    await expect(admitExternalReleaseAssets({ directory: fixture.assets, sourceRevision: revision,
      packageVersion: version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })).rejects.toThrow()
  })

  it.each(['viewer-build', 'viewer-notices'] as const)('rejects an authenticated viewer with torn %s license metadata', async (kind) => {
    const fixture = await remoteFixture({}, kind)
    const admitted = await admitReleasePackage(fixture.directory, revision, version)
    await expect(admitExternalReleaseAssets({ directory: fixture.assets, sourceRevision: revision,
      packageVersion: version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })).rejects.toThrow()
  })

  it('bounds streamed downloads and rejects non-HTTPS redirects, HTTP failure and a caller abort', async () => {
    const fixture = await remoteFixture()
    const admitted = await admitReleasePackage(fixture.directory, revision, version)
    await expect(admitPublishedReleaseAssets(admitted, { fetcher: async () => new Response('missing', { status: 404 }) })).rejects.toThrow('HTTP 404')
    await expect(admitPublishedReleaseAssets(admitted, { fetcher: async () => {
      const response = new Response('unqualified')
      Object.defineProperty(response, 'url', { value: 'http://insecure.invalid/asset' })
      return response
    } })).rejects.toThrow('outside HTTPS')
    await expect(admitPublishedReleaseAssets(admitted, { fetcher: async () => new Response(Buffer.alloc(1024 * 1024)) })).rejects.toThrow('encoded size')
    await expect(admitPublishedReleaseAssets(admitted, { signal: AbortSignal.abort(new Error('cancelled')) })).rejects.toThrow('cancelled')
  })

  it('rejects an authenticated gzip whose decoded viewer tar contains a symlink', async () => {
    const fixture = await remoteFixture()
    const admitted = await admitReleasePackage(fixture.directory, revision, version)
    const tar = gunzipSync(fixture.payloads[admitted.viewer.asset]!)
    tar[156] = 50
    tar.fill(32, 148, 156)
    const checksum = tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0)
    tar.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
    const encoded = gzipSync(tar)
    Object.assign(admitted.viewer, { bytes: tar.length, sha256: digest(tar), compression: { format: 'gzip', bytes: encoded.length, sha256: digest(encoded) } })
    const header = Buffer.from(JSON.stringify(admitted.viewer, null, 2) + '\n')
    admitted.headers.viewer = { bytes: header.length, sha256: digest(header) }
    await writeFile(join(fixture.assets, 'viewer-release.json'), header)
    await writeFile(join(fixture.assets, admitted.viewer.asset), encoded)
    await expect(admitExternalReleaseAssets({ directory: fixture.assets, sourceRevision: revision,
      packageVersion: version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })).rejects.toThrow('Unsupported viewer archive entry')
  })
})

describe('downloaded native artifact assembly', () => {
  it.skipIf(process.platform === 'win32')('encodes authenticated Go and workers without changing downloads or duplicating originals', async () => {
    const fixture = await assemblyFixture()
    await execFile(process.execPath, ['scripts/native/assemble.mjs', '--input', fixture.input], { cwd: fixture.root })
    const release = JSON.parse(await readFile(join(fixture.root, 'native-release.json'), 'utf8'))
    expect(Object.keys(release.artifacts)).toEqual(Object.keys(NATIVE_TARGETS))
    for (const file of fixture.files) {
      expect(await readFile(file.source)).toEqual(file.bytes)
      expect((await stat(file.source)).mode & 0o777).toBe(0o644)
      const delivered = await readFile(file.destination)
      expect(gunzipSync(delivered)).toEqual(file.bytes)
      expect((await stat(file.destination)).mode & 0o777).toBe(0o644)
      await expect(stat(join(fixture.root, 'native-artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
      const original = file.destination.includes('oxlint-') ? release.artifacts[file.target].oxlint : release.artifacts[file.target]
      expect(original.sha256).toBe(file.sha256)
      expect(original.compression.bytes).toBe(delivered.length)
      expect(original.compression.sha256).toBe(createHash('sha256').update(delivered).digest('hex'))
    }
  })

  it.skipIf(process.platform === 'win32').each(['Go', 'worker'] as const)('rejects same-length %s corruption before staging those bytes', async (kind) => {
    const fixture = await assemblyFixture()
    const file = fixture.files[kind === 'Go' ? 0 : 1]!
    const corrupted = Buffer.from(file.bytes)
    corrupted[0] = corrupted[0]! ^ 1
    await writeFile(file.source, corrupted)
    await expect(execFile(process.execPath, ['scripts/native/assemble.mjs', '--input', fixture.input], { cwd: fixture.root }))
      .rejects.toThrow('bytes differ from its build manifest')
    await expect(stat(file.destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(file.source)).toEqual(corrupted)
  })

  it.skipIf(process.platform === 'win32').each(['symlink', 'directory'] as const)('rejects a downloaded %s instead of following or normalizing it', async (kind) => {
    const fixture = await assemblyFixture()
    const file = fixture.files[0]!
    const foreign = join(fixture.root, 'foreign')
    await writeFile(foreign, file.bytes, { mode: 0o644 })
    await rm(file.source)
    if (kind === 'symlink') await symlink(foreign, file.source)
    else await mkdir(file.source)
    await expect(execFile(process.execPath, ['scripts/native/assemble.mjs', '--input', fixture.input], { cwd: fixture.root }))
      .rejects.toThrow('downloaded artifact is not a regular file')
    await expect(stat(file.destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(foreign)).toEqual(file.bytes)
    expect((await stat(foreign)).mode & 0o777).toBe(0o644)
  })
})

// These synthetic files qualify transport/assembly only and are never executed.
async function assemblyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-assembly-transport-'))
  temporary.push(root)
  const input = join(root, 'downloads')
  const scripts = join(root, 'scripts/native')
  await mkdir(scripts, { recursive: true })
  for (const name of ['assemble.mjs', 'shared.mjs', 'compression.mjs']) {
    await copyFile(new URL(`../scripts/native/${name}`, import.meta.url), join(scripts, name))
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ version, type: 'module' }))
  const files: { source: string, destination: string, bytes: Buffer, sha256: string, target: string }[] = []
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const bytes = Buffer.from(`assembly fixture ${target} Go`)
    const workerBytes = Buffer.from(`assembly fixture ${target} worker`)
    const worker = expected.oxlint ? oxlintDescriptor(target, workerBytes) : undefined
    const artifact = { target, executable: expected.executable,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(worker ? { oxlint: worker } : {}),
    }
    const source = join(input, target)
    const destination = join(root, '.native-release-assets')
    const toolchain = { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture',
      ...(worker ? { oxlint: { rustc: 'fixture', cargo: 'fixture', cargoLockSha256: '5'.repeat(64) } } : {}),
    }
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'manifest.json'), JSON.stringify({
      format: 'astrale.codegraph.native-artifact', version: 1, packageVersion: version, protocolVersion: 1, artifact,
    }))
    await writeFile(join(source, 'build.json'), JSON.stringify({
      format: 'astrale.codegraph.native-build', version: 1, packageVersion: version, protocolVersion: 1,
      source: { revision, dirty: false }, toolchain, artifact,
    }))
    for (const record of [{ descriptor: artifact, bytes }, ...(worker ? [{ descriptor: worker, bytes: workerBytes }] : [])]) {
      const path = join(source, record.descriptor.executable)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, record.bytes)
      await chmod(path, 0o644)
      files.push({ source: path, destination: join(destination, nativeReleaseAssetName(target, record.descriptor === worker ? 'oxlint' : 'native', revision)),
        bytes: record.bytes, sha256: record.descriptor.sha256, target })
    }
  }
  return { root, input, files }
}

async function releaseFixture(corruption?: 'binary' | 'dependency' | 'version' | 'oxlint' | 'missing-oxlint' | 'oxlint-source' | 'notices' | 'stray' | 'second-archive', compressed = false) {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-release-admission-'))
  temporary.push(root)
  const output = join(root, 'archives')
  await mkdir(output)
  const artifacts: Record<string, unknown> = {}
  const executables: Record<string, Buffer> = {}
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const bytes = Buffer.from(`qualified ${target} executable`)
    const workerBytes = Buffer.from(`archive admission fixture ${target} worker`)
    const oxlint = expected.oxlint ? oxlintDescriptor(target, workerBytes) : undefined
    if (oxlint && corruption === 'oxlint-source' && target === 'linux-x64') oxlint.source.patchSha256 = '6'.repeat(64)
    artifacts[target] = {
      target, executable: expected.executable,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(oxlint && !(corruption === 'missing-oxlint' && target === 'linux-x64') ? { oxlint } : {}),
    }
    executables[`native-artifacts/${target}/${expected.executable}`] =
      corruption === 'binary' && target === 'darwin-arm64' ? Buffer.from('changed') : bytes
    if (oxlint) executables[`native-artifacts/${target}/${oxlint.executable}`] =
      corruption === 'oxlint' && target === 'linux-x64' ? Buffer.from('changed') : workerBytes
  }
  if (compressed) {
    for (const [target, unknownArtifact] of Object.entries(artifacts)) {
      const artifact = unknownArtifact as { executable: string; compression?: unknown; oxlint?: { executable: string; compression?: unknown } }
      for (const original of [artifact, ...(artifact.oxlint ? [artifact.oxlint] : [])]) {
        const path = `native-artifacts/${target}/${original.executable}`
        const encoded = gzipSync(executables[path]!)
        original.compression = { format: 'gzip', path: `${original.executable}.gz`, bytes: encoded.length,
          sha256: createHash('sha256').update(encoded).digest('hex') }
        delete executables[path]
        executables[`${path}.gz`] = encoded
      }
    }
  }
  if (corruption === 'stray') executables['native-artifacts/linux-arm64/bin/unqualified'] = Buffer.from('unqualified')
  await packFixture(root, output, '@astrale-os/codegraph', {
    'LICENSE': Buffer.from('release license fixture\n'),
    'THIRD_PARTY_NOTICES.md': Buffer.from(corruption === 'notices' ? '' : 'release third-party notices fixture\n'),
    'package.json': {
      ...publicManifest('@astrale-os/codegraph'),
      ...(corruption === 'version' ? { version: '0.0.0' } : {}),
      ...(corruption === 'dependency'
        ? { optionalDependencies: { '@astrale-os/codegraph-native-linux-x64': version } } : {}),
    },
    'native-release.json': {
      format: 'astrale.codegraph.native-release', version: 1, packageVersion: version,
      protocolVersion: 1, sourceRevision: revision, artifacts,
      toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture',
        oxlint: { rustc: 'fixture', cargo: 'fixture', cargoLockSha256: '5'.repeat(64) } },
    },
    ...executables,
  })
  if (corruption === 'second-archive') {
    await packFixture(root, output, '@astrale-os/codegraph-native-linux-x64', { 'package.json': {} })
  }
  return output
}

async function remoteFixture(extra: Record<string, Buffer> = {}, corruption?: 'source' | 'path' | 'viewer-source' | 'worker-source' | 'viewer-build' | 'viewer-notices') {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-remote-admission-'))
  temporary.push(root)
  const directory = join(root, 'archives'), assets = join(root, 'assets'), viewerRoot = join(root, 'viewer')
  await Promise.all([mkdir(directory), mkdir(assets), mkdir(viewerRoot)])
  const artifacts: Record<string, unknown> = {}, payloads: Record<string, Buffer> = {}
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const bytes = Buffer.from(`remote fixture ${target} Go`), workerBytes = Buffer.from(`remote fixture ${target} worker`)
    const worker = expected.oxlint ? { ...oxlintDescriptor(target, workerBytes), compression: compression(target, 'oxlint', workerBytes) } : undefined
    if (worker && corruption === 'worker-source' && target === 'linux-x64') worker.source.patchSha256 = '6'.repeat(64)
    artifacts[target] = { target, executable: expected.executable, bytes: bytes.length, sha256: digest(bytes),
      compression: compression(target, 'native', bytes), ...(worker ? { oxlint: worker } : {}) }
  }
  function compression(target: string, kind: string, bytes: Buffer) {
    const path = nativeReleaseAssetName(target, kind, corruption === 'path' ? '2'.repeat(40) : revision)
    const encoded = gzipSync(bytes)
    payloads[path] = encoded
    return { format: 'gzip', path, bytes: encoded.length, sha256: digest(encoded) }
  }
  for (const [path, bytes] of Object.entries({ 'index.html': '<html>fixture</html>',
    'THIRD_PARTY_NOTICES.txt': 'fixture licenses', 'viewer-build.json': JSON.stringify({ format: corruption === 'viewer-build' ? 'unqualified' : 'codegraph.viewer-build.v1',
      packages: corruption === 'viewer-notices' ? [{ name: 'fixture', version: '1.0.0', notices: [] }] : [] }) })) {
    await writeFile(join(viewerRoot, path), bytes)
  }
  const { buildViewerArchive } = await import('../scripts/viewer/archive.mjs')
  const built = await buildViewerArchive(viewerRoot)
  const viewer = { format: 'codegraph.viewer-release.v1', packageVersion: version,
    sourceRevision: corruption === 'viewer-source' ? '2'.repeat(40) : revision, asset: `viewer-${revision}.tar.gz`, ...built.descriptor }
  payloads[viewer.asset] = built.gzip
  const native = { format: 'astrale.codegraph.native-release', version: 1, delivery: 'github-release', packageVersion: version,
    protocolVersion: 1, sourceRevision: corruption === 'source' ? '2'.repeat(40) : revision, artifacts,
    toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture', oxlint: { rustc: 'fixture', cargo: 'fixture', cargoLockSha256: '5'.repeat(64) } } }
  payloads['native-release.json'] = Buffer.from(stableJson(native))
  payloads['viewer-release.json'] = Buffer.from(JSON.stringify(viewer, null, 2) + '\n')
  await Promise.all(Object.entries(payloads).map(([name, bytes]) => writeFile(join(assets, name), bytes)))
  await packFixture(root, directory, '@astrale-os/codegraph', { 'package.json': publicManifest('@astrale-os/codegraph'),
    'native-release.json': payloads['native-release.json'], 'viewer-release.json': payloads['viewer-release.json'],
    LICENSE: Buffer.from('license fixture'), 'THIRD_PARTY_NOTICES.md': Buffer.from('notices fixture'), ...extra })
  return { directory, assets, payloads }
}
function digest(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex') }

function oxlintDescriptor(target: string, bytes: Buffer) {
  return { executable: oxlintExecutable(target), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), engineVersion: '1.81.0', protocolVersion: 1,
    source: { revision: '3'.repeat(40), patchSha256: '4'.repeat(64) } }
}

function publicManifest(name: string) {
  return { name, version, private: false, type: 'module',
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    repository: { url: `git+https://github.com/${repository}.git` },
  }
}

async function packFixture(root: string, output: string, name: string, files: Record<string, unknown>) {
  const slug = name.replace('@', '').replace('/', '-')
  const directory = join(root, slug)
  for (const [path, value] of Object.entries(files)) {
    const file = join(directory, 'package', path)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, Buffer.isBuffer(value) ? value : JSON.stringify(value))
  }
  await execFile('tar', ['-czf', join(output, `${slug}-${version}.tgz`), '-C', directory, 'package'])
}

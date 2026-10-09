import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeNativeArtifact } from '../analysis/typescript/distribution/materialize.ts'
import { readNativeReleaseManifest } from '../analysis/typescript/distribution/manifest.ts'

const execFile = promisify(execFileCallback)
const target = `${process.platform}-${process.arch}`
const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-materialize-'))
  temporary.push(root)
  const packageRoot = join(root, 'package')
  const cacheRoot = join(root, 'cache')
  await mkdir(join(packageRoot, 'bin'), { recursive: true })
  const bytes = Buffer.from('qualified native original\n'.repeat(30_000))
  const gzip = gzipSync(bytes)
  const artifact = {
    executable: 'bin/codegraph-native', bytes: bytes.length, sha256: hash(bytes),
    compression: { format: 'gzip' as const, path: 'bin/codegraph-native.gz', bytes: gzip.length, sha256: hash(gzip) },
  }
  const source = join(packageRoot, artifact.compression.path)
  await writeFile(source, gzip)
  return { root, packageRoot, cacheRoot, bytes, gzip, artifact, source,
    materialize: () => materializeNativeArtifact(packageRoot, artifact, target, cacheRoot) }
}

async function cacheFiles(f: Awaited<ReturnType<typeof fixture>>) {
  try { return await readdir(f.cacheRoot) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

describe('native gzip materialization', () => {
  it('extracts exact bytes from a read-only package and reuses one stable executable', async () => {
    const f = await fixture()
    await chmod(f.source, 0o444); await chmod(join(f.packageRoot, 'bin'), 0o555); await chmod(f.packageRoot, 0o555)
    try {
      const command = await f.materialize()
      expect(await readFile(command)).toEqual(f.bytes)
      expect((await lstat(command)).mode & 0o111).not.toBe(0)
      const before = await lstat(command)
      expect(await f.materialize()).toBe(command)
      expect((await lstat(command)).ino).toBe(before.ino)
      expect(await cacheFiles(f)).toEqual([command.slice(f.cacheRoot.length + 1)])
      expect(await readdir(join(f.packageRoot, 'bin'))).toEqual(['codegraph-native.gz'])
    } finally { await chmod(f.packageRoot, 0o755); await chmod(join(f.packageRoot, 'bin'), 0o755) }
  })

  it('recovers a corrupted or non-executable cache without changing the package', async () => {
    const f = await fixture()
    const command = await f.materialize()
    await writeFile(command, Buffer.alloc(f.bytes.length, 0))
    expect(await f.materialize()).toBe(command)
    expect(await readFile(command)).toEqual(f.bytes)
    if (process.platform !== 'win32') {
      await chmod(command, 0o644)
      expect(await f.materialize()).toBe(command)
      expect((await lstat(command)).mode & 0o111).not.toBe(0)
    }
    expect(await readFile(f.source)).toEqual(f.gzip)
    expect(await cacheFiles(f)).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('replaces a corrupt cache inode while an existing reader retains its complete original', async () => {
    const f = await fixture()
    const command = await f.materialize()
    const { open } = await import('node:fs/promises')
    const reader = await open(command, 'r')
    try {
      // A symlink cache is inadmissible and must be replaced rather than followed.
      const foreign = join(f.root, 'foreign')
      await writeFile(foreign, 'unrelated')
      await rm(command); await symlink(foreign, command)
      await f.materialize()
      expect(await reader.readFile()).toEqual(f.bytes)
      expect(await readFile(foreign, 'utf8')).toBe('unrelated')
      expect((await lstat(command)).isSymbolicLink()).toBe(false)
    } finally { await reader.close() }
  })

  it.each(['source-digest', 'original-digest', 'truncated', 'compressed-bound', 'original-bound'] as const)(
    'fails closed and cleans only its staging file on %s corruption', async (kind) => {
      const f = await fixture()
      const artifact = structuredClone(f.artifact)
      if (kind === 'source-digest') artifact.compression.sha256 = '0'.repeat(64)
      if (kind === 'original-digest') artifact.sha256 = '0'.repeat(64)
      if (kind === 'compressed-bound') artifact.compression.bytes--
      if (kind === 'original-bound') artifact.bytes--
      if (kind === 'truncated') {
        const truncated = f.gzip.subarray(0, f.gzip.length - 8)
        await writeFile(f.source, truncated)
        artifact.compression = { ...artifact.compression, bytes: truncated.length, sha256: hash(truncated) }
      }
      await expect(materializeNativeArtifact(f.packageRoot, artifact, target, f.cacheRoot)).rejects.toMatchObject({
        code: kind === 'truncated' ? 'NATIVE_ARTIFACT_INVALID' : 'NATIVE_ARTIFACT_DIGEST_MISMATCH',
      })
      expect(await cacheFiles(f)).toEqual([])
      // A failed attempt must not poison the in-process retry lifecycle.
      await writeFile(f.source, f.gzip)
      expect(await readFile(await f.materialize())).toEqual(f.bytes)
    },
  )

  it('rejects a compressed source escaping the package even when its bytes match', async () => {
    const f = await fixture()
    const outside = join(f.root, 'outside.gz')
    await writeFile(outside, f.gzip); await rm(f.source); await symlink(outside, f.source)
    await expect(f.materialize()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
    expect(await cacheFiles(f)).toEqual([])
  })

  it('keeps cache filesystem failures in the distribution error contract and leaves unrelated state untouched', async () => {
    const f = await fixture()
    await writeFile(f.cacheRoot, 'unrelated file')
    await expect(f.materialize()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
    expect(await readFile(f.cacheRoot, 'utf8')).toBe('unrelated file')
    await rm(f.cacheRoot)
    await mkdir(f.cacheRoot)
    await writeFile(join(f.cacheRoot, '.another-request.tmp'), 'not ours')
    await f.materialize()
    expect(await readFile(join(f.cacheRoot, '.another-request.tmp'), 'utf8')).toBe('not ours')
  })

  it('converges across independent processes without leaving staging files or losing either original identity', async () => {
    const f = await fixture()
    const module = new URL('../analysis/typescript/distribution/materialize.ts', import.meta.url).href
    const program = `import { materializeNativeArtifact } from ${JSON.stringify(module)};
      console.log(await materializeNativeArtifact(process.argv[1], JSON.parse(process.argv[2]), process.argv[3], process.argv[4]));`
    const calls = await Promise.all(Array.from({ length: 6 }, () => execFile(process.execPath,
      ['--input-type=module', '-e', program, f.packageRoot, JSON.stringify(f.artifact), target, f.cacheRoot])))
    const commands = calls.map((call) => call.stdout.trim())
    expect(new Set(commands).size).toBe(1)
    expect(await readFile(commands[0]!)).toEqual(f.bytes)
    expect(await cacheFiles(f)).toHaveLength(1)
    const workerBytes = Buffer.from('different qualified worker')
    const gzip = gzipSync(workerBytes)
    const worker = { ...f.artifact, executable: 'bin/codegraph-oxlint', bytes: workerBytes.length, sha256: hash(workerBytes),
      compression: { format: 'gzip' as const, path: 'bin/codegraph-oxlint.gz', bytes: gzip.length, sha256: hash(gzip) } }
    await writeFile(join(f.packageRoot, worker.compression.path), gzip)
    const workerCommand = await materializeNativeArtifact(f.packageRoot, worker, target, f.cacheRoot)
    expect(workerCommand).not.toBe(commands[0])
    expect(await readFile(workerCommand)).toEqual(workerBytes)
    expect(await cacheFiles(f)).toHaveLength(2)
  })

  it.each([
    { format: 'zip' }, { path: '../outside.gz' }, { path: '/absolute.gz' }, { path: 'bin\\outside.gz' },
    { bytes: 0 }, { sha256: 'invalid' },
  ])('rejects invalid storage descriptors before executable resolution: %j', async (changed) => {
    const f = await fixture()
    const path = join(f.root, 'release.json')
    await writeFile(path, JSON.stringify({
      format: 'astrale.codegraph.native-release', version: 1, packageVersion: '0.1.1', protocolVersion: 1,
      sourceRevision: '1'.repeat(40), toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture' },
      artifacts: { [target]: { ...f.artifact, target, compression: { ...f.artifact.compression, ...changed } } },
    }))
    await expect(readNativeReleaseManifest(path, '0.1.1', target)).rejects.toMatchObject({ code: 'NATIVE_RELEASE_MANIFEST_INVALID' })
  })
})

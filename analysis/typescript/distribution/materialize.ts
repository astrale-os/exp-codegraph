import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import type { NativeAnalysisArtifact, NativeOxlintArtifact } from './model.ts'
import { NativeAnalysisDistributionError } from './model.ts'

type Executable = Pick<NativeAnalysisArtifact | NativeOxlintArtifact, 'executable' | 'bytes' | 'sha256' | 'compression'>
const pending = new Map<string, Promise<string>>()

/** Package bytes stay read-only. Only this request's staging file is ever removed. */
export async function materializeNativeArtifact(
  artifactRoot: string,
  artifact: Executable,
  target: string,
  cacheRoot = nativeCacheRoot(),
): Promise<string> {
  try { artifactRoot = await realpath(artifactRoot) } catch (cause) {
    throw failure('NATIVE_ARTIFACT_INVALID', `Packaged ${target} artifact directory is unreadable.`, target, cause)
  }
  const cache = resolve(cacheRoot)
  const command = join(cache, `${target}-${artifact.sha256}${target === 'win32-x64' ? '.exe' : ''}`)
  if (await matchesExecutable(command, artifact, target)) return command
  const key = JSON.stringify([artifactRoot, artifact, cache])
  const existing = pending.get(key)
  if (existing) return existing
  const request = extract(artifactRoot, artifact, target, cache, command)
  pending.set(key, request)
  try { return await request } finally { pending.delete(key) }
}

async function extract(artifactRoot: string, artifact: Executable, target: string, cache: string, command: string) {
  const compressed = artifact.compression!
  let source: string
  try {
    source = await realpath(resolve(artifactRoot, compressed.path))
    if (!within(artifactRoot, source) || !(await stat(source)).isFile()) throw new Error('Not a package file.')
  } catch (cause) {
    throw failure('NATIVE_ARTIFACT_INVALID', `Packaged ${target} compressed artifact is missing or outside its directory.`, target, cause)
  }
  const staging = join(cache, `.${target}-${artifact.sha256}-${randomUUID()}.tmp`)
  try {
    await mkdir(cache, { recursive: true, mode: 0o700 })
    await pipeline(
      createReadStream(source),
      checkedBytes(compressed, target, 'Compressed native artifact'),
      createGunzip(),
      checkedBytes(artifact, target, 'Native executable'),
      createWriteStream(staging, { flags: 'wx', mode: 0o600 }),
    )
    await chmod(staging, 0o755)
    // A healthy winner needs no replacement. Otherwise rename publishes the fully
    // checked inode atomically, including automatic recovery of a corrupted cache.
    if (await matchesExecutable(command, artifact, target)) return command
    try { await rename(staging, command) } catch (cause) {
      // Windows may reject replacing an executable another process already uses.
      // Accept that winner only if its original identity still matches the release.
      if (!(await matchesExecutable(command, artifact, target))) throw cause
    }
    if (!(await matchesExecutable(command, artifact, target))) {
      throw failure('NATIVE_ARTIFACT_DIGEST_MISMATCH', `Materialized ${target} executable does not match its release.`, target)
    }
    return command
  } catch (cause) {
    if (cause instanceof NativeAnalysisDistributionError) throw cause
    throw failure('NATIVE_ARTIFACT_INVALID', `Cannot materialize packaged ${target} executable.`, target, cause)
  } finally {
    try { await rm(staging, { force: true }) } catch (cause) {
      throw failure('NATIVE_ARTIFACT_INVALID', `Cannot clean ${target} materialization staging.`, target, cause)
    }
  }
}

function checkedBytes(expected: { bytes: number, sha256: string }, target: string, label: string) {
  let bytes = 0
  const hash = createHash('sha256')
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length
      if (bytes > expected.bytes) {
        done(failure('NATIVE_ARTIFACT_DIGEST_MISMATCH', `${label} exceeds its qualified size.`, target))
        return
      }
      hash.update(chunk)
      done(null, chunk)
    },
    flush(done) {
      done(bytes === expected.bytes && hash.digest('hex') === expected.sha256 ? undefined :
        failure('NATIVE_ARTIFACT_DIGEST_MISMATCH', `${label} does not match its qualified size or digest.`, target))
    },
  })
}

async function matchesExecutable(path: string, expected: Executable, target: string): Promise<boolean> {
  try {
    // A cache symlink is never treated as an admitted content entry.
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.size !== expected.bytes) return false
    const digest = await admitExecutable(path, target)
    return digest.bytes === expected.bytes && digest.sha256 === expected.sha256
  } catch { return false }
}

export async function admitExecutable(path: string, target: string): Promise<{ bytes: number; sha256: string }> {
  let metadata
  try { metadata = await stat(path) } catch (cause) {
    throw failure('NATIVE_ARTIFACT_INVALID', `Native analyzer is not a readable regular file: ${path}`, target, cause)
  }
  if (!metadata.isFile()) throw failure('NATIVE_ARTIFACT_INVALID', `Native analyzer is not a regular file: ${path}`, target)
  if (process.platform !== 'win32' && (metadata.mode & 0o111) === 0) {
    throw failure('NATIVE_ARTIFACT_NOT_EXECUTABLE', `Native analyzer is not executable: ${path}`, target)
  }
  let bytes = 0
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk) }
  return { bytes, sha256: hash.digest('hex') }
}

function nativeCacheRoot(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'codegraph', 'native')
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'codegraph', 'native')
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'codegraph', 'native')
}

function within(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}

function failure(code: ConstructorParameters<typeof NativeAnalysisDistributionError>[0], message: string, target: string, cause?: unknown) {
  return new NativeAnalysisDistributionError(code, message, target, cause === undefined ? undefined : { cause })
}

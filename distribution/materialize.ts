import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import type { ArtifactCacheOptions, ArtifactDescriptor, ArtifactIntegrity, ArtifactSource } from './model.ts'
import { ArtifactDistributionError, releaseArtifactURL } from './model.ts'

const pending = new Map<string, Promise<string>>()

/** One admitted file per content identity, without modifying packages or retaining encoded copies. */
export async function materializeArtifact(
  source: ArtifactSource,
  artifact: ArtifactDescriptor,
  options: ArtifactCacheOptions,
): Promise<string> {
  options.signal?.throwIfAborted()
  if ('release' in source) releaseArtifactURL(source.release, source.asset)
  for (const identity of [artifact, ...(artifact.compression ? [artifact.compression] : [])]) {
    if (!Number.isSafeInteger(identity.bytes) || identity.bytes < 1 || !/^[a-f0-9]{64}$/u.test(identity.sha256)) throw failure('ARTIFACT_INVALID', 'Artifact integrity descriptor is invalid.')
  }
  if (artifact.compression && artifact.compression.format !== 'gzip') throw failure('ARTIFACT_INVALID', 'Unsupported artifact encoding.')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(options.cacheKey) || !options.cacheKey.includes(artifact.sha256)) {
    throw failure('ARTIFACT_INVALID', 'Artifact cache key must be a basename containing its original SHA.')
  }
  const cache = resolve(options.cacheRoot), destination = join(cache, options.cacheKey)
  if (await matchesArtifact(destination, artifact, options.executable)) {
    options.signal?.throwIfAborted()
    return destination
  }
  const key = JSON.stringify([source, artifact, cache, options.cacheKey, Boolean(options.executable)])
  // A caller's cancellation must never cancel another caller's shared download.
  if (!options.signal) {
    const existing = pending.get(key)
    if (existing) return existing
  }
  const request = extract(source, artifact, options, cache, destination)
  if (options.signal) return request
  pending.set(key, request)
  try { return await request } finally { pending.delete(key) }
}

async function extract(source: ArtifactSource, artifact: ArtifactDescriptor, options: ArtifactCacheOptions, cache: string, destination: string) {
  const staging = join(cache, `.${options.cacheKey}-${randomUUID()}.tmp`)
  try {
    await mkdir(cache, { recursive: true, mode: 0o700 })
    options.signal?.throwIfAborted()
    const input = await openSource(source, options.signal)
    await pipeline(input, checkedBytes(artifact.compression ?? artifact, 'Encoded artifact'),
      ...(artifact.compression ? [createGunzip(), checkedBytes(artifact, 'Decoded artifact')] : []),
      createWriteStream(staging, { flags: 'wx', mode: 0o600 }), { signal: options.signal })
    await chmod(staging, options.executable ? 0o755 : 0o644)
    options.signal?.throwIfAborted()
    if (await matchesArtifact(destination, artifact, options.executable)) return destination
    try { await rename(staging, destination) } catch (cause) {
      // An independent request may have published this same admitted identity.
      if (!(await matchesArtifact(destination, artifact, options.executable))) throw cause
    }
    if (!(await matchesArtifact(destination, artifact, options.executable))) {
      throw failure('ARTIFACT_DIGEST_MISMATCH', 'Materialized artifact does not match its qualified identity.')
    }
    return destination
  } catch (cause) {
    if (options.signal?.aborted) throw options.signal.reason
    if (cause instanceof ArtifactDistributionError) throw cause
    throw failure('ARTIFACT_INVALID', 'Cannot materialize the qualified artifact.', cause)
  } finally {
    try { await rm(staging, { force: true }) } catch (cause) {
      throw failure('ARTIFACT_INVALID', 'Cannot clean owned artifact staging.', cause)
    }
  }
}

async function openSource(source: ArtifactSource, signal?: AbortSignal): Promise<Readable> {
  if ('path' in source) {
    let path: string
    try {
      path = await realpath(source.path)
      if (!(await stat(path)).isFile()) throw new Error('Not a regular artifact file.')
      if (source.root) {
        const root = await realpath(source.root), value = relative(root, path)
        if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) throw new Error('Artifact escapes its authority.')
      }
    } catch (cause) { throw failure('ARTIFACT_INVALID', 'Artifact source is missing or outside its authority.', cause) }
    return createReadStream(path)
  }
  const url = releaseArtifactURL(source.release, source.asset)
  try {
    const deadline = AbortSignal.timeout(120_000)
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    if (!response.url.startsWith('https://')) throw new Error('Artifact download redirected outside HTTPS.')
    return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  } catch (cause) {
    if (signal?.aborted) throw signal.reason
    throw failure('ARTIFACT_DOWNLOAD_FAILED', `Cannot download qualified artifact ${url}. Retry after restoring network access, or preload its cache before going offline.`, cause)
  }
}

function checkedBytes(expected: ArtifactIntegrity, label: string) {
  let bytes = 0
  const hash = createHash('sha256')
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length
      if (bytes > expected.bytes) return done(failure('ARTIFACT_DIGEST_MISMATCH', `${label} exceeds its qualified size.`))
      hash.update(chunk)
      done(null, chunk)
    },
    flush(done) {
      done(bytes === expected.bytes && hash.digest('hex') === expected.sha256 ? undefined :
        failure('ARTIFACT_DIGEST_MISMATCH', `${label} does not match its qualified size or digest.`))
    },
  })
}

async function matchesArtifact(path: string, expected: ArtifactIntegrity, executable?: boolean): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.size !== expected.bytes) return false
    const digest = await admitArtifactFile(path, executable)
    return digest.bytes === expected.bytes && digest.sha256 === expected.sha256
  } catch { return false }
}

export async function admitArtifactFile(path: string, executable = false): Promise<ArtifactIntegrity> {
  let metadata
  try { metadata = await stat(path) } catch (cause) { throw failure('ARTIFACT_INVALID', `Artifact is not readable: ${path}`, cause) }
  if (!metadata.isFile()) throw failure('ARTIFACT_INVALID', `Artifact is not a regular file: ${path}`)
  if (executable && process.platform !== 'win32' && (metadata.mode & 0o111) === 0) {
    throw failure('ARTIFACT_NOT_EXECUTABLE', `Artifact is not executable: ${path}`)
  }
  let bytes = 0
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk) }
  return { bytes, sha256: hash.digest('hex') }
}

export function artifactCacheRoot(kind: 'native' | 'viewer'): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'codegraph', kind)
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'codegraph', kind)
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'codegraph', kind)
}

function failure(code: ConstructorParameters<typeof ArtifactDistributionError>[0], message: string, cause?: unknown) {
  return new ArtifactDistributionError(code, message, cause === undefined ? undefined : { cause })
}

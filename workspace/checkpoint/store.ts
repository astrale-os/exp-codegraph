import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type {
  FileWorkspaceCheckpointStore,
  FileWorkspaceCheckpointStoreOptions,
  NormalizedLimits,
  WorkspaceCheckpointArtifactDescriptor,
  WorkspaceCheckpointManifest,
  WorkspaceCheckpointMiss,
  WorkspaceCheckpointMissReason,
} from './model.ts'
import {
  SHA256,
  canonicalJson,
  isAbort,
  isRecord,
  normalizeLimits,
  preparePublication,
  sha256,
  throwIfAborted,
  validateScope,
  validateStoredManifest,
} from './validation.ts'
import { mapCheckpointWork } from './store.optimization.ts'

const TEMPORARY_AGE_MS = 24 * 60 * 60 * 1_000
const LOAD_CONCURRENCY = 32
const PUBLISH_CONCURRENCY = 32

type BlobLoadResult =
  | {
      readonly ok: true
      readonly digest: string
      readonly bytes: Buffer
      readonly metadata: TrustedBlobMetadata
    }
  | { readonly ok: false; readonly reason: WorkspaceCheckpointMissReason }

interface TrustedBlobMetadata {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

/** Create a generic advisory filesystem-backed checkpoint store. */
export function createFileWorkspaceCheckpointStore(
  options: FileWorkspaceCheckpointStoreOptions,
): FileWorkspaceCheckpointStore {
  const limits = normalizeLimits(options)
  const directory = resolve(options.directory)
  const manifestDirectory = join(directory, 'manifests')
  const blobDirectory = join(directory, 'blobs', 'sha256')
  const defaultSignal = options.signal
  // Digests admitted by load or installed by this store do not need their immutable blob file read
  // and hashed again on the next delta publication. Caller bytes are still copied and hashed before
  // this proof is consulted, so mutating a previously returned Uint8Array cannot alias stale data.
  const trustedBlobs = new Map<string, TrustedBlobMetadata>()
  const maximumTrustedBlobs = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, limits.maxArtifacts * 2))
  let disposed = false

  const assertReady = (signal?: AbortSignal): void => {
    if (disposed) throw new Error('Workspace checkpoint store has been disposed.')
    throwIfAborted(signal ?? defaultSignal)
  }

  const operationSignal = (signal?: AbortSignal): AbortSignal | undefined => signal ?? defaultSignal

  return {
    async load(scope, operationOptions = {}) {
      const signal = operationSignal(operationOptions.signal)
      assertReady(signal)
      const validatedScope = validateScope(scope)
      const target = manifestPath(manifestDirectory, validatedScope)

      let bytes: Buffer
      try {
        const metadata = await lstat(target)
        throwIfAborted(signal)
        if (!metadata.isFile()) return miss('manifest-invalid')
        if (metadata.size > limits.maxManifestBytes) return miss('manifest-too-large')
        bytes = await readFile(target, { signal })
      } catch (error) {
        throwIfAborted(signal, error)
        if (isMissing(error)) return miss('manifest-missing')
        return miss('manifest-unreadable')
      }

      throwIfAborted(signal)
      if (bytes.byteLength > limits.maxManifestBytes) return miss('manifest-too-large')

      let parsed: unknown
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as unknown
      } catch {
        return miss('manifest-invalid')
      }

      let manifest: WorkspaceCheckpointManifest
      try {
        manifest = validateStoredManifest(parsed, validatedScope, limits)
        const canonical = canonicalJson(manifest)
        if (Buffer.byteLength(canonical, 'utf8') !== bytes.byteLength || canonical !== bytes.toString('utf8')) {
          return miss('manifest-invalid')
        }
      } catch {
        return miss('manifest-invalid')
      }

      const requestedKeys = operationOptions.artifactKeys === undefined
        ? undefined
        : new Set(operationOptions.artifactKeys)
      if (
        requestedKeys &&
        (requestedKeys.size !== operationOptions.artifactKeys!.length ||
          [...requestedKeys].some((key) => typeof key !== 'string'))
      ) {
        throw new TypeError('Checkpoint artifact selection must contain unique string keys.')
      }
      const selectedArtifacts = requestedKeys
        ? manifest.artifacts.filter(({ key }) => requestedKeys.has(key))
        : manifest.artifacts
      if (requestedKeys && selectedArtifacts.length !== requestedKeys.size) {
        return miss('artifact-missing')
      }

      const artifacts = new Map<string, Uint8Array>()
      let totalBytes = 0
      const seenDigests = new Set<string>()
      for (const descriptor of selectedArtifacts) {
        throwIfAborted(signal)
        if (descriptor.bytes > limits.maxArtifactBytes) return miss('artifact-too-large')
        if (!seenDigests.has(descriptor.digest)) {
          totalBytes += descriptor.bytes
          if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
            return miss('artifacts-too-large')
          }
          seenDigests.add(descriptor.digest)
        }
      }

      const unique = new Map<string, (typeof manifest.artifacts)[number]>()
      for (const descriptor of selectedArtifacts) {
        if (!unique.has(descriptor.digest)) unique.set(descriptor.digest, descriptor)
      }
      const loaded = await mapCheckpointWork(
        [...unique.values()],
        LOAD_CONCURRENCY,
        (descriptor) => loadBlob(blobDirectory, descriptor, limits, signal),
      )
      const failed = loaded.find(
        (result): result is Extract<BlobLoadResult, { readonly ok: false }> => !result.ok,
      )
      if (failed) return miss(failed.reason)
      const successful = loaded.filter(
        (result): result is Extract<BlobLoadResult, { readonly ok: true }> => result.ok,
      )
      const loadedByDigest = new Map(
        successful.map((result) => [result.digest, result.bytes] as const),
      )
      for (const result of successful) {
        rememberTrustedBlob(trustedBlobs, result.digest, result.metadata, maximumTrustedBlobs)
      }
      for (const descriptor of selectedArtifacts) {
        const artifactBytes = loadedByDigest.get(descriptor.digest)
        if (!artifactBytes) return miss('artifact-missing')
        artifacts.set(descriptor.key, artifactBytes)
      }

      return { ok: true, manifest, artifacts }
    },

    async publish(scope, input, operationOptions = {}) {
      const signal = operationSignal(input.signal ?? operationOptions.signal)
      assertReady(signal)
      const validatedScope = validateScope(scope)
      const prepared = preparePublication(validatedScope, input, limits)
      throwIfAborted(signal)
      await mkdir(manifestDirectory, { recursive: true, mode: 0o700 })
      await mkdir(blobDirectory, { recursive: true, mode: 0o700 })
      throwIfAborted(signal)

      const installedDigests = new Set<string>()
      try {
        const uniqueArtifacts = [...new Map(
          prepared.artifacts.map((artifact) => [artifact.digest, artifact] as const),
        ).values()]
        const installed = await mapCheckpointWork(
          uniqueArtifacts,
          PUBLISH_CONCURRENCY,
          async (artifact) => {
            throwIfAborted(signal)
            const target = join(blobDirectory, artifact.digest)
            const trusted = trustedBlobs.get(artifact.digest)
            if (
              (trusted && await installedBlobMatchesMetadata(target, trusted, signal)) ||
              await installedBlobExists(target, artifact.digest, artifact.data, signal, limits)
            ) {
              await rememberInstalledBlob(
                trustedBlobs,
                target,
                artifact.digest,
                maximumTrustedBlobs,
                signal,
              )
              return artifact.digest
            }
            const temporary = temporaryPath(blobDirectory, `.${artifact.digest}`)
            try {
              await writeDurably(temporary, artifact.data, signal)
              await installBlob(temporary, target, artifact.digest, artifact.data, signal, limits)
              await rememberInstalledBlob(
                trustedBlobs,
                target,
                artifact.digest,
                maximumTrustedBlobs,
                signal,
              )
              return artifact.digest
            } finally {
              await removeQuietly(temporary)
            }
          },
        )
        for (const digest of installed) installedDigests.add(digest)

        throwIfAborted(signal)
        const manifestTarget = manifestPath(manifestDirectory, validatedScope)
        const manifestTemporary = temporaryPath(manifestDirectory, `.${validatedScope}`)
        try {
          await writeDurably(manifestTemporary, prepared.bytes, signal)
          await replaceFile(manifestTemporary, manifestTarget)
          await fsyncDirectory(manifestDirectory)
        } finally {
          await removeQuietly(manifestTemporary)
        }
      } finally {
        await pruneBestEffort(
          manifestDirectory,
          blobDirectory,
          limits,
          installedDigests,
          validatedScope,
          signal,
        )
      }
    },

    async remove(scope, operationOptions = {}) {
      const signal = operationSignal(operationOptions.signal)
      assertReady(signal)
      const validatedScope = validateScope(scope)
      throwIfAborted(signal)
      try {
        await rm(manifestPath(manifestDirectory, validatedScope), { force: true })
        await fsyncDirectory(manifestDirectory)
      } catch (error) {
        throwIfAborted(signal, error)
        if (!isMissing(error)) throw error
      }
    },

    async dispose() {
      disposed = true
      trustedBlobs.clear()
    },
  }
}

function manifestPath(directory: string, scope: string): string {
  return join(directory, `${scope}.json`)
}

function temporaryPath(directory: string, prefix: string): string {
  return join(directory, `${prefix}.${process.pid}.${randomUUID()}.tmp`)
}

function miss(reason: WorkspaceCheckpointMissReason): WorkspaceCheckpointMiss {
  return { ok: false, reason }
}

async function loadBlob(
  directory: string,
  descriptor: WorkspaceCheckpointArtifactDescriptor,
  limits: NormalizedLimits,
  signal?: AbortSignal,
): Promise<BlobLoadResult> {
  const blob = join(directory, descriptor.digest)
  let bytes: Buffer
  let admittedMetadata: TrustedBlobMetadata
  try {
    const metadata = await lstat(blob)
    throwIfAborted(signal)
    if (!metadata.isFile()) return { ok: false, reason: 'artifact-unreadable' }
    if (metadata.size > limits.maxArtifactBytes) return { ok: false, reason: 'artifact-too-large' }
    if (metadata.size !== descriptor.bytes) return { ok: false, reason: 'artifact-corrupt' }
    admittedMetadata = blobMetadata(metadata)
    bytes = await readFile(blob, { signal })
  } catch (error) {
    throwIfAborted(signal, error)
    return { ok: false, reason: isMissing(error) ? 'artifact-missing' : 'artifact-unreadable' }
  }
  throwIfAborted(signal)
  if (bytes.byteLength > limits.maxArtifactBytes) return { ok: false, reason: 'artifact-too-large' }
  if (bytes.byteLength !== descriptor.bytes || sha256(bytes) !== descriptor.digest) {
    return { ok: false, reason: 'artifact-corrupt' }
  }
  return {
    ok: true,
    digest: descriptor.digest,
    bytes,
    metadata: admittedMetadata,
  }
}

async function writeDurably(file: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    let offset = 0
    while (offset < bytes.byteLength) {
      throwIfAborted(signal)
      const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset)
      offset += result.bytesWritten
      if (result.bytesWritten === 0) throw new Error('Checkpoint temporary file made no write progress.')
    }
    throwIfAborted(signal)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function installedBlobExists(
  target: string,
  digest: string,
  expected: Uint8Array,
  signal: AbortSignal | undefined,
  limits: NormalizedLimits,
): Promise<boolean> {
  try {
    const metadata = await lstat(target)
    throwIfAborted(signal)
    if (!metadata.isFile() || metadata.size !== expected.byteLength || metadata.size > limits.maxArtifactBytes) {
      return false
    }
    const bytes = await readFile(target, { signal })
    if (bytes.byteLength !== expected.byteLength || sha256(bytes) !== digest) return false
    return true
  } catch (error) {
    throwIfAborted(signal, error)
    if (isMissing(error)) return false
    return false
  }
}

async function installedBlobMatchesMetadata(
  target: string,
  expected: TrustedBlobMetadata,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const metadata = await lstat(target)
    throwIfAborted(signal)
    return metadata.isFile() && sameBlobMetadata(blobMetadata(metadata), expected)
  } catch (error) {
    throwIfAborted(signal, error)
    return false
  }
}

async function rememberInstalledBlob(
  trusted: Map<string, TrustedBlobMetadata>,
  target: string,
  digest: string,
  capacity: number,
  signal?: AbortSignal,
): Promise<void> {
  const metadata = await lstat(target)
  throwIfAborted(signal)
  if (!metadata.isFile()) return
  rememberTrustedBlob(trusted, digest, blobMetadata(metadata), capacity)
}

function rememberTrustedBlob(
  trusted: Map<string, TrustedBlobMetadata>,
  digest: string,
  metadata: TrustedBlobMetadata,
  capacity: number,
): void {
  trusted.delete(digest)
  trusted.set(digest, metadata)
  while (trusted.size > capacity) trusted.delete(trusted.keys().next().value!)
}

function blobMetadata(metadata: {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}): TrustedBlobMetadata {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  }
}

function sameBlobMetadata(left: TrustedBlobMetadata, right: TrustedBlobMetadata): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

async function installBlob(
  temporary: string,
  target: string,
  digest: string,
  expected: Uint8Array,
  signal: AbortSignal | undefined,
  limits: NormalizedLimits,
): Promise<void> {
  throwIfAborted(signal)
  const existing = await blobMatches(target, digest, expected, signal, limits)
  if (existing === true) {
    await removeQuietly(temporary)
    return
  }
  throwIfAborted(signal)
  await replaceFile(temporary, target)
}

async function blobMatches(
  target: string,
  digest: string,
  expected: Uint8Array,
  signal: AbortSignal | undefined,
  limits: NormalizedLimits,
): Promise<boolean | undefined> {
  try {
    const metadata = await lstat(target)
    throwIfAborted(signal)
    if (!metadata.isFile() || metadata.size > limits.maxArtifactBytes || metadata.size !== expected.byteLength) return false
    const bytes = await readFile(target, { signal })
    return bytes.byteLength === expected.byteLength && sha256(bytes) === digest
  } catch (error) {
    throwIfAborted(signal, error)
    if (isMissing(error)) return undefined
    return false
  }
}

async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target)
  } catch (error) {
    if (!isReplaceRace(error)) throw error
    // Windows does not replace an existing file with rename. The brief absence is safe for an
    // advisory checkpoint: readers take the ordinary cold path and never see partial bytes.
    await rm(target, { force: true })
    await rename(source, target)
  }
}

async function pruneBestEffort(
  manifestDirectory: string,
  blobDirectory: string,
  limits: NormalizedLimits,
  protectedDigests: ReadonlySet<string>,
  protectedScope: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    throwIfAborted(signal)
    await cleanupStaleTemporaryFiles(manifestDirectory, signal)
    await cleanupStaleTemporaryFiles(blobDirectory, signal)
    await pruneManifestScopes(manifestDirectory, limits.maximumScopes, protectedScope, signal)
    const references = await referencedDigests(manifestDirectory, limits, signal)
    if (references === undefined) return
    for (const digest of protectedDigests) references.add(digest)
    const entries = await readdir(blobDirectory, { withFileTypes: true })
    const blobs: { readonly path: string; readonly name: string; readonly bytes: number; readonly mtimeMs: number }[] = []
    let total = 0
    for (const entry of entries) {
      throwIfAborted(signal)
      if (!entry.isFile() || !SHA256.test(entry.name)) continue
      try {
        const file = join(blobDirectory, entry.name)
        const metadata = await lstat(file)
        if (!metadata.isFile()) continue
        blobs.push({ path: file, name: entry.name, bytes: metadata.size, mtimeMs: metadata.mtimeMs })
        total += metadata.size
      } catch {
        // Another writer may have installed or removed this blob.
      }
    }
    if (!Number.isSafeInteger(total) || total <= limits.maxTotalBytes) return
    blobs.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
    const now = Date.now()
    for (const blob of blobs) {
      if (total <= limits.maxTotalBytes) break
      if (references.has(blob.name)) continue
      // A just-created unreferenced blob may belong to a concurrent writer whose manifest has not
      // reached its final rename yet. Leave recent files for a later best-effort prune.
      if (now - blob.mtimeMs < 60_000) continue
      await removeQuietly(blob.path)
      total -= blob.bytes
    }
  } catch (error) {
    if (isAbort(error)) return
    // Persistence is advisory. A read-only directory or a concurrent race cannot make publish fail.
  }
}

async function pruneManifestScopes(
  directory: string,
  maximumScopes: number,
  protectedScope: string,
  signal?: AbortSignal,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  const manifests: { readonly path: string; readonly scope: string; readonly mtimeMs: number }[] = []
  for (const entry of entries) {
    throwIfAborted(signal)
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (!metadata.isFile()) continue
    manifests.push({
      path,
      scope: entry.name.slice(0, -'.json'.length),
      mtimeMs: metadata.mtimeMs,
    })
  }
  manifests.sort(
    (left, right) =>
      (left.scope === protectedScope ? -1 : right.scope === protectedScope ? 1 : 0) ||
      right.mtimeMs - left.mtimeMs ||
      left.scope.localeCompare(right.scope),
  )
  await Promise.all(manifests.slice(maximumScopes).map((manifest) => removeQuietly(manifest.path)))
}

async function referencedDigests(
  manifestDirectory: string,
  limits: NormalizedLimits,
  signal?: AbortSignal,
): Promise<Set<string> | undefined> {
  let entries
  try {
    entries = await readdir(manifestDirectory, { withFileTypes: true })
  } catch {
    return new Set()
  }
  const references = new Set<string>()
  for (const entry of entries) {
    throwIfAborted(signal)
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const file = join(manifestDirectory, entry.name)
      const metadata = await lstat(file)
      if (!metadata.isFile() || metadata.size > limits.maxManifestBytes) return undefined
      const parsed = JSON.parse((await readFile(file, { signal })).toString('utf8')) as unknown
      if (!isRecord(parsed) || !Array.isArray(parsed.artifacts)) return undefined
      for (const descriptor of parsed.artifacts) {
        if (!isRecord(descriptor) || typeof descriptor.digest !== 'string' || !SHA256.test(descriptor.digest)) return undefined
        references.add(descriptor.digest)
      }
    } catch (error) {
      throwIfAborted(signal, error)
      return undefined
    }
  }
  return references
}

async function cleanupStaleTemporaryFiles(directory: string, signal?: AbortSignal): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  const now = Date.now()
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
      .map(async (entry) => {
        throwIfAborted(signal)
        const file = join(directory, entry.name)
        try {
          if (now - (await lstat(file)).mtimeMs >= TEMPORARY_AGE_MS) await removeQuietly(file)
        } catch {
          // Another writer may have completed this temporary file.
        }
      }),
  )
}

async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, constants.O_RDONLY)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Directory fsync is unavailable on some platforms; file fsync still protects contents.
  }
}

async function removeQuietly(file: string): Promise<void> {
  try {
    await rm(file, { force: true })
  } catch {
    // Advisory cleanup.
  }
}

function isMissing(error: unknown): boolean {
  return isNodeError(error, 'ENOENT')
}

function isReplaceRace(error: unknown): boolean {
  return isNodeError(error, 'EEXIST') || isNodeError(error, 'EPERM')
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

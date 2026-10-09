import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactCacheRoot, materializeArtifact } from '../distribution/materialize.ts'
import { MAX_VIEWER_ARCHIVE_BYTES, openViewerArchive, type ViewerArchive } from './viewer-archive.ts'

interface ViewerRelease {
  readonly format: 'codegraph.viewer-release.v1'
  readonly packageVersion: string
  readonly sourceRevision: string
  readonly asset: string
  readonly bytes: number
  readonly sha256: string
  readonly compression: { readonly format: 'gzip'; readonly bytes: number; readonly sha256: string }
}

/** Optional CI warm-up. Ordinary imports and headless analysis never download viewer assets. */
export async function preloadViewer(options: { signal?: AbortSignal } = {}): Promise<void> {
  const archive = await resolveViewerArchive(options)
  await archive.close()
}

/** Installed start and explicit preload use the same release identity and cache admission. */
export async function resolveViewerArchive(options: { signal?: AbortSignal } = {}): Promise<ViewerArchive> {
  const directory = dirname(fileURLToPath(import.meta.url))
  const packageRoot = basename(dirname(directory)) === 'dist' ? resolve(directory, '../..') : resolve(directory, '..')
  return openReleasedViewer(packageRoot, artifactCacheRoot('viewer'), options)
}

/** Package and cache roots are owned by the caller, never inferred from a project being inspected. */
export async function openReleasedViewer(packageRoot: string, cacheRoot: string, options: { signal?: AbortSignal } = {}): Promise<ViewerArchive> {
  options.signal?.throwIfAborted()
  const [header, packageJson, nativeHeader] = await Promise.all([
    readFile(resolve(packageRoot, 'viewer-release.json'), 'utf8'),
    readFile(resolve(packageRoot, 'package.json'), 'utf8'),
    readFile(resolve(packageRoot, 'native-release.json'), 'utf8'),
  ])
  const version: unknown = JSON.parse(packageJson).version
  const native: unknown = JSON.parse(nativeHeader)
  const release = admitViewerRelease(JSON.parse(header), version, record(native) && native.packageVersion === version ? native.sourceRevision : undefined)
  const path = await materializeArtifact(
    { release: { packageVersion: release.packageVersion, sourceRevision: release.sourceRevision }, asset: release.asset },
    release,
    { cacheRoot, cacheKey: `viewer-${release.sha256}.tar`, ...options },
  )
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
  const archive = await openViewerArchive(path, release)
  if (options.signal?.aborted) {
    await archive.close()
    throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
  return archive
}

export function admitViewerRelease(value: unknown, packageVersion: unknown, sourceRevision: unknown): ViewerRelease {
  if (!record(value) || value.format !== 'codegraph.viewer-release.v1' || typeof packageVersion !== 'string' || value.packageVersion !== packageVersion || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(packageVersion) || typeof sourceRevision !== 'string' || value.sourceRevision !== sourceRevision || !/^[a-f0-9]{40}$/.test(sourceRevision) || value.asset !== `viewer-${sourceRevision}.tar.gz` || !identity(value, MAX_VIEWER_ARCHIVE_BYTES) || value.bytes < 1024 || value.bytes % 512 !== 0 || !record(value.compression) || value.compression.format !== 'gzip' || !identity(value.compression, MAX_VIEWER_ARCHIVE_BYTES)) {
    throw new Error('Viewer release does not match this Codegraph package or its authenticated artifact contract.')
  }
  return Object.freeze({
    format: 'codegraph.viewer-release.v1', packageVersion, sourceRevision,
    asset: `viewer-${sourceRevision}.tar.gz`, bytes: value.bytes, sha256: value.sha256,
    compression: Object.freeze({ format: 'gzip', bytes: value.compression.bytes, sha256: value.compression.sha256 }),
  })
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function identity(value: Record<string, unknown>, limit: number): value is Record<string, unknown> & { bytes: number; sha256: string } {
  return typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= limit && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
}

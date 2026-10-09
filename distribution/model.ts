/** Identity of an external artifact bound to the installed package's exact release. */
export interface ArtifactRelease {
  readonly packageVersion: string
  readonly sourceRevision: string
}

export interface ArtifactIntegrity {
  readonly bytes: number
  readonly sha256: string
}

export interface ArtifactDescriptor extends ArtifactIntegrity {
  readonly compression?: ArtifactIntegrity & { readonly format: 'gzip' }
}

export type ArtifactSource =
  | { readonly path: string; readonly root?: string }
  | { readonly release: ArtifactRelease; readonly asset: string }

export interface ArtifactCacheOptions {
  readonly cacheRoot: string
  /** A basename incorporating the original SHA; consumers never resolve a mutable latest entry. */
  readonly cacheKey: string
  readonly executable?: boolean
  readonly signal?: AbortSignal
}

export type ArtifactDistributionErrorCode =
  | 'ARTIFACT_INVALID'
  | 'ARTIFACT_DIGEST_MISMATCH'
  | 'ARTIFACT_NOT_EXECUTABLE'
  | 'ARTIFACT_DOWNLOAD_FAILED'

export class ArtifactDistributionError extends Error {
  readonly name = 'ArtifactDistributionError'
  readonly code: ArtifactDistributionErrorCode
  constructor(code: ArtifactDistributionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/** URLs are fixed to this repository and immutable version/source names, never a mutable latest. */
export function releaseArtifactURL(release: ArtifactRelease, asset: string): string {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/u.test(release.packageVersion) ||
    !/^[a-f0-9]{40}$/u.test(release.sourceRevision) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(asset)) {
    throw new ArtifactDistributionError('ARTIFACT_INVALID', 'Invalid source-bound release artifact location.')
  }
  return `https://github.com/astrale-os/exp-codegraph/releases/download/codegraph-v${release.packageVersion}-${release.sourceRevision}/${asset}`
}

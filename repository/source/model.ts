import type { SourceId, SourceManifestId, SourceRevisionId } from '../../analysis/index.ts'

export type RepositorySourceRequest =
  | {
      readonly source: SourceId
      readonly path?: never
      readonly revision?: SourceRevisionId
      readonly signal?: AbortSignal
    }
  | {
      readonly path: string
      readonly source?: never
      readonly revision?: SourceRevisionId
      readonly signal?: AbortSignal
    }

export type RepositorySourceRead =
  | {
      readonly status: 'current'
      readonly inventory: SourceManifestId
      readonly source: SourceId
      readonly revision: SourceRevisionId
      readonly path: string
      readonly text: string
    }
  | {
      readonly status: 'stale'
      readonly inventory: SourceManifestId
      readonly source: SourceId
      readonly expected: SourceRevisionId
      readonly actual?: SourceRevisionId
      readonly path: string
    }
  | {
      readonly status: 'unavailable'
      readonly inventory: SourceManifestId
      readonly source?: SourceId
      readonly reason: 'not-in-inventory' | 'not-text' | 'unreadable'
      readonly path?: string
      readonly message?: string
    }

export interface RepositorySourceService {
  readonly inventory: SourceManifestId
  read(request: RepositorySourceRequest): Promise<RepositorySourceRead>
}

export interface RepositorySourceServiceOptions {
  /** Maximum UTF-8 source retained by one read. Defaults to 16 MiB. */
  readonly maximumTextBytes?: number
}

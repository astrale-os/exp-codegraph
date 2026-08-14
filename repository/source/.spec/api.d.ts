import type { SourceId, SourceManifestId, SourceRevisionId } from '../../../analysis/identity/.spec/api.js'
import type { RepositoryInventory } from '../../.spec/api.js'

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
  readonly maximumTextBytes?: number
}

export const DEFAULT_REPOSITORY_SOURCE_MAXIMUM_TEXT_BYTES: number

export function createRepositorySourceService(
  root: string,
  inventory: RepositoryInventory,
  options?: RepositorySourceServiceOptions,
): RepositorySourceService

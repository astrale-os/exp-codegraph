import type { RepositoryId, SourceManifestId } from '../../analysis/index.ts'
import type { RepositoryInventory, RepositoryStatisticsReport } from '../../repository/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'
import type { TypeSpecApplicationSnapshot } from '../model.ts'

export interface ApplicationCheckpointExpectation {
  readonly repository: RepositoryId
  readonly inventory: SourceManifestId
  readonly request: string
  readonly signal?: AbortSignal
}

export interface ApplicationCheckpointContent {
  readonly snapshot: TypeSpecApplicationSnapshot
  /** Complete discovered corpus; a focused snapshot may contain only a subset. */
  readonly specifications: readonly SpecificationSnapshot[]
  readonly inventory: RepositoryInventory
  readonly statistics: RepositoryStatisticsReport
}

export type ApplicationCheckpointLoadResult =
  | { readonly ok: true; readonly content: ApplicationCheckpointContent }
  | {
      readonly ok: false
      readonly reason: 'missing' | 'incompatible' | 'corrupt' | 'unavailable'
    }

/** Application-owned codec over a generic advisory workspace checkpoint store. */
export interface ApplicationCheckpoint {
  load(expectation: ApplicationCheckpointExpectation): Promise<ApplicationCheckpointLoadResult>
  publish(
    expectation: ApplicationCheckpointExpectation,
    content: ApplicationCheckpointContent,
  ): Promise<void>
}

import type { RepositoryId, SourceManifestId } from '../../analysis/index.ts'
import type { RepositoryInventory, RepositoryStatisticsReport } from '../../repository/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'
import type { TypeSpecApplicationSnapshot } from '../model.ts'

export interface ApplicationCheckpointExpectation {
  readonly repository: RepositoryId
  readonly inventory: SourceManifestId
  /** Corpus-affecting discovery scope, independent of selection and qualification policy. */
  readonly corpus: string
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
  | {
      readonly ok: true
      /** Exact requests can publish immediately; corpus hits must refresh derived products. */
      readonly exact: boolean
      readonly content: ApplicationCheckpointContent
    }
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

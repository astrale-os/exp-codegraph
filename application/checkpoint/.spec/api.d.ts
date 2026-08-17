import type { AnalysisGenerationId, ProjectUniverseId } from '../../../analysis/identity/.spec/api.js'
import type { FileWorkspaceCheckpointStore } from '../../../workspace/checkpoint/.spec/api.js'
import type { RepositoryStatisticsReport } from '../../../repository/statistics/.spec/api.js'
import type { RepositoryInventory } from '../../../repository/.spec/api.js'
import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'
import type { TypeSpecApplicationSnapshot } from '../../.spec/api.js'

export interface ApplicationCheckpointExpectation {
  readonly repository: `repository:${string}`
  readonly inventory: `source-manifest:${string}`
  readonly corpus: string
  readonly request: string
  readonly signal?: AbortSignal
}

export interface ApplicationCheckpointContent {
  readonly snapshot: TypeSpecApplicationSnapshot
  readonly specifications: readonly SpecificationSnapshot[]
  readonly inventory: RepositoryInventory
  readonly statistics: RepositoryStatisticsReport
}

export type ApplicationCheckpointLoadResult =
  | { readonly ok: true; readonly exact: boolean; readonly content: ApplicationCheckpointContent }
  | { readonly ok: false; readonly reason: 'missing' | 'incompatible' | 'corrupt' | 'unavailable' }

export interface ApplicationCheckpoint {
  load(expectation: ApplicationCheckpointExpectation): Promise<ApplicationCheckpointLoadResult>
  publish(expectation: ApplicationCheckpointExpectation, content: ApplicationCheckpointContent): Promise<void>
}

export function createApplicationCheckpoint(options: {
  readonly store: FileWorkspaceCheckpointStore
  readonly producerFingerprint: string
}): ApplicationCheckpoint

export function checkpointGenerations(
  snapshot: TypeSpecApplicationSnapshot,
): ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>

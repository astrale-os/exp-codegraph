import type {
  AnalysisSnapshotSet,
  AnalysisGenerationId,
  AnalysisTelemetrySink,
  NativeAnalysisSessionFactory,
  NativeModuleBoundary,
  NativeSourceChange,
  ProjectUniverseId,
  RepositoryId,
  SourceManifestId,
} from '../../analysis/index.ts'
import type { TypeScriptRefreshResult } from '../../analysis/typescript/index.ts'
import type { RepositoryInventory } from '../../repository/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'
import type {
  ApplicationObservationRefresh,
  ApplicationSchemaDependencyResource,
} from '../observation/index.ts'

export interface ApplicationAnalysisRefreshOptions {
  readonly specifications: readonly SpecificationSnapshot[]
  /** Complete repository corpus retained in the repository-scoped observation universe. */
  readonly observationSpecifications?: readonly SpecificationSnapshot[]
  readonly refreshSpecifications?: readonly string[]
  readonly inventory: RepositoryInventory
  readonly schemaDependencies?: readonly ApplicationSchemaDependencyResource[]
  readonly compilerAnalysis?: boolean
  readonly changed?: readonly string[]
  readonly changes?: readonly NativeSourceChange[]
  /** Focused primary module identities eligible for bounded resident compiler retention. */
  readonly residentModules?: readonly string[]
  readonly invalidate?: boolean
  readonly signal?: AbortSignal
}

export interface ApplicationAnalysisRefresh {
  readonly snapshot: AnalysisSnapshotSet
  readonly universes: readonly ProjectUniverseId[]
  readonly boundaries: readonly NativeModuleBoundary[]
  readonly results: readonly TypeScriptRefreshResult[]
  readonly observation: ApplicationObservationRefresh
  readonly diagnostics: readonly string[]
  /** Exact changed module subjects, or absent when qualification must conservatively refresh all owners. */
  readonly affectedModules?: readonly string[]
}

/** Resident multi-project analysis owned by an application, never by a presentation projection. */
export interface ApplicationAnalysisWorkspace {
  refresh(options: ApplicationAnalysisRefreshOptions): Promise<ApplicationAnalysisRefresh>
  /** Reopen already-materialized exact generations without starting a compiler session. */
  open(
    generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>,
    inventory: SourceManifestId,
  ): Promise<AnalysisSnapshotSet>
  dispose(): Promise<void>
}

export interface ApplicationAnalysisWorkspaceOptions {
  readonly root: string
  readonly repository: RepositoryId
  readonly sessions: NativeAnalysisSessionFactory
  readonly store?: import('../../analysis/index.ts').AnalysisStore
  readonly maximumRetainedGenerations?: number
  readonly telemetry?: AnalysisTelemetrySink
}

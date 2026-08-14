import type {
  AnalysisSnapshotSet,
  NativeAnalysisSessionFactory,
  NativeModuleBoundary,
  ProjectUniverseId,
  RepositoryId,
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
  readonly inventory: RepositoryInventory
  readonly schemaDependencies?: readonly ApplicationSchemaDependencyResource[]
  readonly compilerAnalysis?: boolean
  readonly changed?: readonly string[]
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
}

/** Resident multi-project analysis owned by an application, never by a presentation projection. */
export interface ApplicationAnalysisWorkspace {
  refresh(options: ApplicationAnalysisRefreshOptions): Promise<ApplicationAnalysisRefresh>
  dispose(): Promise<void>
}

export interface ApplicationAnalysisWorkspaceOptions {
  readonly root: string
  readonly repository: RepositoryId
  readonly sessions: NativeAnalysisSessionFactory
  readonly store?: import('../../analysis/index.ts').AnalysisStore
  readonly maximumRetainedGenerations?: number
}

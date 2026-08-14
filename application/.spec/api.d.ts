import type { QualificationSnapshot } from '../../conformance/.spec/api.js'
import type { AnalysisStore } from '../../analysis/query/.spec/api.js'
import type { AnalysisQuery } from '../../analysis/query/.spec/api.js'
import type { PassId, ProjectUniverseId, SourceId } from '../../analysis/identity/.spec/api.js'
import type {
  RepositorySourceRead,
  RepositorySourceRequest,
} from '../../repository/source/.spec/api.js'
import type { RepositoryStatisticsReport } from '../../repository/statistics/.spec/api.js'
import type { SpecificationSnapshot } from '../../specification/.spec/api.js'

interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointer?: string
}

export type TypeSpecApplicationSnapshotId = `application:${string}`

export type TypeSpecApplicationSelection =
  | { readonly kind: 'full'; readonly authority: 'full-ci' }
  | {
      readonly kind: 'focused'
      readonly authority: 'advisory'
      readonly requested: readonly string[]
      readonly primary: readonly string[]
      readonly selected: readonly string[]
      readonly support: readonly string[]
      readonly included: readonly string[]
      readonly includeDependents: boolean
    }

export interface TypeSpecApplicationSnapshot {
  readonly format: 'astrale.typespec.application'
  readonly version: 2
  readonly id: TypeSpecApplicationSnapshotId
  readonly repository: `repository:${string}`
  readonly inventory: `source-manifest:${string}`
  readonly selection: TypeSpecApplicationSelection
  readonly specifications: readonly SpecificationSnapshot[]
  readonly statistics: RepositoryStatisticsReport
  readonly qualifications: readonly QualificationSnapshot[]
  readonly analysis?: {
    readonly id: `snapshot-set:${string}`
    readonly inventory: `source-manifest:${string}`
    readonly universes: readonly `project-universe:${string}`[]
  }
  readonly diagnostics: readonly Diagnostic[]
  readonly analysisDiagnostics: readonly string[]
}

export interface TypeSpecApplicationRefreshOptions {
  readonly exclude?: readonly string[]
  readonly select?: readonly string[]
  readonly focused?: boolean
  readonly includeDependents?: boolean
  readonly requireCompleteLayout?: boolean
  readonly requireExactLayout?: boolean
  readonly requestedProfiles?: readonly string[]
  readonly schemaRoots?: readonly string[]
  readonly compilerAnalysis?: boolean
  readonly changed?: readonly string[]
  readonly invalidate?: boolean
  readonly qualify?: boolean
  readonly signal?: AbortSignal
}

export interface TypeSpecApplicationService {
  refresh(options?: TypeSpecApplicationRefreshOptions): Promise<TypeSpecApplicationRefresh>
  current(): TypeSpecApplicationSnapshot | undefined
  open(snapshot?: TypeSpecApplicationSnapshotId): Promise<TypeSpecApplicationReader>
  dispose(): Promise<void>
}

export interface TypeSpecApplicationChanges {
  readonly previous?: TypeSpecApplicationSnapshotId
  readonly specifications: {
    readonly added: readonly string[]
    readonly changed: readonly string[]
    readonly removed: readonly string[]
  }
  readonly sources: readonly SourceId[]
  readonly invalidatedPasses: readonly PassId[]
}

export interface TypeSpecApplicationTiming {
  readonly totalMs: number
  readonly discoverMs: number
  readonly compileMs: number
  readonly inventoryMs: number
  readonly statisticsMs: number
  readonly analysisMs: number
  readonly qualificationMs: number
}

export interface TypeSpecApplicationRefresh {
  readonly snapshot: TypeSpecApplicationSnapshot
  readonly changes: TypeSpecApplicationChanges
  readonly timing: TypeSpecApplicationTiming
}

export interface TypeSpecApplicationReader {
  readonly snapshot: TypeSpecApplicationSnapshot
  query(universe: ProjectUniverseId): Promise<AnalysisQuery>
  source(request: RepositorySourceRequest): Promise<RepositorySourceRead>
  dispose(): Promise<void>
}

export interface TypeSpecApplicationOptions {
  readonly root: string
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly analysis?: {
    readonly store?: AnalysisStore
    readonly maximumRetainedGenerations?: number
  }
  readonly native?: {
    readonly binary?: string
    readonly cacheDirectory?: string
    readonly environment?: Readonly<Record<string, string | undefined>>
    readonly maximumFrameBytes?: number
    readonly transactionChunkFrameBytes?: number
    readonly maximumTransactionBytes?: number
  }
}

export function createTypeSpecApplicationService(
  options: TypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService>

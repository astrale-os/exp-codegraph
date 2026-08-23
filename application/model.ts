import type {
  AnalysisGenerationId,
  AnalysisQuery,
  PassId,
  ProjectUniverseId,
  RepositoryId,
  SnapshotSetId,
  SourceId,
  SourceManifestId,
} from '../analysis/index.ts'
import type { QualificationSnapshot } from '../conformance/index.ts'
import type {
  RepositorySourceRead,
  RepositorySourceRequest,
  RepositoryStatisticsReport,
} from '../repository/index.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'

export type TypeSpecApplicationSnapshotId = `application:${string}`
export type TypeSpecApplicationCapability =
  | 'declaration-models'
  | 'declaration-navigation'
  | 'repository-statistics'

export type TypeSpecApplicationSelection =
  | { readonly kind: 'full'; readonly authority: 'full-ci' }
  | {
      readonly kind: 'focused'
      readonly authority: 'advisory'
      readonly requested: readonly string[]
      /** Exact owners matched before optional dependent expansion. */
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
  /** Portable logical repository identity; physical checkout roots belong to the reader. */
  readonly repository: RepositoryId
  /** Exact repository inventory shared by specification, analysis, and source reads. */
  readonly inventory: SourceManifestId
  readonly capabilities: readonly TypeSpecApplicationCapability[]
  readonly selection: TypeSpecApplicationSelection
  readonly specifications: readonly SpecificationSnapshot[]
  /** Complete repository-wide physical statistics retained independently from UI projections. */
  readonly statistics?: RepositoryStatisticsReport
  readonly qualifications: readonly QualificationSnapshot[]
  readonly analysis?: {
    readonly id: SnapshotSetId
    readonly inventory: SourceManifestId
    readonly universes: readonly ProjectUniverseId[]
    readonly generations: readonly {
      readonly universe: ProjectUniverseId
      readonly generation: AnalysisGenerationId
    }[]
  }
  readonly diagnostics: readonly Diagnostic[]
  readonly analysisDiagnostics: readonly string[]
}

export interface TypeSpecApplicationRefreshOptions {
  /** Defaults to the complete application capability set for non-request-planned consumers. */
  readonly requestedCapabilities?: readonly TypeSpecApplicationCapability[]
  readonly exclude?: readonly string[]
  readonly select?: readonly string[]
  readonly focused?: boolean
  readonly includeDependents?: boolean
  readonly requireCompleteLayout?: boolean
  readonly requireExactLayout?: boolean
  readonly requestedProfiles?: readonly string[]
  /** Additional closed schema catalogs, supplied explicitly and pinned by content revision. */
  readonly schemaRoots?: readonly string[]
  /** Skip compiler universes for repository/specification-only profile sets. */
  readonly compilerAnalysis?: boolean
  readonly changed?: readonly string[]
  readonly invalidate?: boolean
  readonly qualify?: boolean
  readonly signal?: AbortSignal
}

export interface TypeSpecApplicationChanges {
  readonly previous?: TypeSpecApplicationSnapshotId
  readonly specifications: {
    readonly added: readonly string[]
    readonly changed: readonly string[]
    readonly removed: readonly string[]
    /** Owners whose compilation or derived observations were refreshed in this operation. */
    readonly refreshed: readonly string[]
  }
  readonly sources: readonly SourceId[]
  readonly invalidatedPasses: readonly PassId[]
}

export interface TypeSpecApplicationTiming {
  readonly totalMs: number
  readonly checkpointMs: number
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
  /** Fresh diagnostic partition used by CLI projections; absent on opaque checkpoint reuse. */
  readonly checkProjection?: {
    readonly sharedDiagnostics: readonly Diagnostic[]
  }
}

/** Non-semantic lifecycle evidence for the latest advisory checkpoint publication. */
export interface TypeSpecApplicationCheckpointPublication {
  readonly repository: RepositoryId
  readonly inventory: SourceManifestId
  readonly outcome: 'published' | 'unavailable'
  readonly durationMs: number
  readonly error?: {
    readonly code: 'APPLICATION_CHECKPOINT_PUBLICATION_UNAVAILABLE'
    readonly name: string
    readonly message: string
  }
}

export interface TypeSpecApplicationSettlement {
  readonly checkpoint?: TypeSpecApplicationCheckpointPublication
}

/** Lease over one exact application snapshot and its pinned analysis generations. */
export interface TypeSpecApplicationReader {
  readonly snapshot: TypeSpecApplicationSnapshot
  query(universe: ProjectUniverseId): Promise<AnalysisQuery>
  source(request: RepositorySourceRequest): Promise<RepositorySourceRead>
  dispose(): Promise<void>
}

export interface TypeSpecApplicationService {
  refresh(options?: TypeSpecApplicationRefreshOptions): Promise<TypeSpecApplicationRefresh>
  current(): TypeSpecApplicationSnapshot | undefined
  open(snapshot?: TypeSpecApplicationSnapshotId): Promise<TypeSpecApplicationReader>
  /** Drain scheduled advisory work and return attributable non-semantic lifecycle evidence. */
  settle(): Promise<TypeSpecApplicationSettlement>
  dispose(): Promise<void>
}

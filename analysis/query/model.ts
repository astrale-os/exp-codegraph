import type { Completeness, Fact, FactHeader, FactShardReference } from '../facts/index.ts'
import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts'
import type {
  AnalysisGenerationId,
  FactId,
  ProjectUniverseId,
  SnapshotSetId,
  SourceId,
  SourceManifestId,
  SymbolId,
} from '../identity/index.ts'

export interface FactFilter {
  readonly namespaces?: readonly string[]
  readonly kinds?: readonly string[]
  readonly subjects?: readonly string[]
  readonly sources?: readonly SourceId[]
  readonly symbols?: readonly SymbolId[]
  readonly completeness?: readonly Completeness['kind'][]
}

export interface PageRequest {
  readonly limit: number
  readonly cursor?: string
}

export interface FactPage {
  readonly facts: readonly Fact[]
  readonly nextCursor?: string
  readonly total?: number
}

export interface FactHeaderPage {
  readonly headers: readonly FactHeader[]
  readonly nextCursor?: string
  readonly total?: number
}

export interface CapabilityStatus {
  readonly capability: string
  readonly completeness: Completeness
}

export interface AnalysisQuery {
  readonly generation: AnalysisGeneration
  dispose(): Promise<void>
  manifest(): Promise<readonly FactShardReference[]>
  capabilities(): Promise<readonly CapabilityStatus[]>
  /** Select indexed envelopes without reading or decoding semantic payloads. */
  headers(filter?: FactFilter, page?: PageRequest): Promise<FactHeaderPage>
  headersById(ids: readonly FactId[]): Promise<readonly FactHeader[]>
  exportHeaders(filter?: FactFilter): AsyncIterable<FactHeader>
  facts(filter?: FactFilter, page?: PageRequest): Promise<FactPage>
  factsById(ids: readonly FactId[]): Promise<readonly Fact[]>
  export(filter?: FactFilter): AsyncIterable<Fact>
}

export interface AnalysisSnapshotSet {
  readonly id: SnapshotSetId
  /** Exact repository inventory revision shared by every pinned universe. */
  readonly inventory: SourceManifestId
  readonly universes: readonly ProjectUniverseId[]
  dispose(): Promise<void>
  query(universe: ProjectUniverseId): Promise<AnalysisQuery>
}

export interface AnalysisStore {
  dispose(): Promise<void>
  current(universe: ProjectUniverseId): Promise<AnalysisGeneration | undefined>
  commit(transaction: FactTransaction, options?: { readonly signal?: AbortSignal }): Promise<void>
  open(
    universe: ProjectUniverseId,
    generation?: AnalysisGenerationId,
  ): Promise<AnalysisQuery>
  snapshotSet(
    generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>,
    inventory: SourceManifestId,
  ): Promise<AnalysisSnapshotSet>
}

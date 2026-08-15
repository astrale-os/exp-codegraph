import type {
  AnalysisGenerationId,
  FactId,
  FactShardDigest,
  FactShardKey,
  PassId,
  SourceId,
  SourceRevisionId,
} from '../identity/index.ts'

export interface SourceSpan {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly start: number
  readonly end: number
}

export interface AnalysisLimit {
  readonly code: string
  readonly message: string
  readonly effective: Readonly<Record<string, number | string | boolean>>
}

export interface AnalysisFailure {
  readonly code: string
  readonly message: string
  readonly attributableTo?: PassId
  readonly retryable: boolean
}

export type Completeness =
  | { readonly kind: 'complete' }
  | { readonly kind: 'partial'; readonly reasons: readonly AnalysisLimit[] }
  | { readonly kind: 'unavailable'; readonly reasons: readonly AnalysisFailure[] }

export interface FactProvenance {
  readonly pass: PassId
  readonly passVersion: string
  readonly evidence: readonly SourceSpan[]
  readonly inputs: readonly FactId[]
}

export interface Fact<Payload = unknown> {
  readonly id: FactId
  readonly generation: AnalysisGenerationId
  readonly namespace: string
  readonly schemaVersion: number
  readonly kind: string
  readonly subject: string
  readonly completeness: Completeness
  readonly provenance: FactProvenance
  readonly payload: Payload
}

export interface FactShardReference {
  readonly key: FactShardKey
  readonly digest: FactShardDigest
  readonly namespace: string
  readonly schemaVersion: number
  readonly facts: number
  /** Semantic capabilities whose completeness is bounded by this shard. */
  readonly capabilities?: readonly string[]
}

export interface FactShard {
  readonly key: FactShardKey
  readonly digest: FactShardDigest
  readonly namespace: string
  readonly schemaVersion: number
  readonly completion: Completeness
  readonly facts: readonly Fact[]
  /** Semantic capabilities whose completeness is bounded by this shard. */
  readonly capabilities?: readonly string[]
}

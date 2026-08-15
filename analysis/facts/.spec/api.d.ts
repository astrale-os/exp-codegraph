import type {
  AnalysisGenerationId,
  FactId,
  FactShardDigest,
  FactShardKey,
  PassId,
  SourceId,
  SourceRevisionId,
} from '../../identity/.spec/api.js'

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

/** Complete portable fact envelope without semantic payload hydration. */
export type FactHeader = Omit<Fact, 'payload'>

export function factHeader(fact: Fact): FactHeader

export interface FactShardReference {
  readonly key: FactShardKey
  readonly digest: FactShardDigest
  readonly namespace: string
  readonly schemaVersion: number
  readonly facts: number
  readonly capabilities?: readonly string[]
}

export interface FactShard {
  readonly key: FactShardKey
  readonly digest: FactShardDigest
  readonly namespace: string
  readonly schemaVersion: number
  readonly completion: Completeness
  readonly facts: readonly Fact[]
  readonly capabilities?: readonly string[]
}

/** Validate ordering, identity, schema, completeness, and provenance at a trust boundary. */
export function validateFactShard(shard: FactShard): readonly string[]
export function factShardDigest(shard: Omit<FactShard, 'digest'>): FactShardDigest
export function shardReference(shard: FactShard): FactShardReference

import type { FactShard, FactShardReference } from '../../facts/.spec/api.js'
import type {
  AnalysisGenerationId,
  FactShardKey,
  ProducerId,
  ProjectUniverseId,
  SourceManifestId,
} from '../../identity/.spec/api.js'

export interface ProducerIdentity {
  readonly id: ProducerId
  readonly name: string
  readonly version: string
  readonly protocolVersion: number
}

export interface AnalysisGeneration {
  readonly id: AnalysisGenerationId
  readonly sequence: number
  readonly universe: ProjectUniverseId
  readonly producer: ProducerIdentity
  readonly sourceManifest: SourceManifestId
  readonly capabilities: readonly string[]
}

export interface FactTransaction {
  readonly protocolVersion: number
  readonly base?: AnalysisGenerationId
  readonly next: AnalysisGeneration
  readonly manifest: readonly FactShardReference[]
  readonly upserts: readonly FactShard[]
  readonly deletes: readonly FactShardKey[]
}

export type TransactionFailureCode =
  | 'PROTOCOL_UNSUPPORTED'
  | 'BASE_STALE'
  | 'GENERATION_INVALID'
  | 'MANIFEST_INVALID'
  | 'SHARD_INVALID'
  | 'TRANSACTION_ABORTED'

export class TransactionError extends Error {
  constructor(code: TransactionFailureCode, message: string, options?: ErrorOptions)
  readonly code: TransactionFailureCode
}

/** Validate a complete next-generation transaction independently of a store implementation. */
export function validateFactTransaction(
  transaction: FactTransaction,
  current?: AnalysisGenerationId,
): readonly string[]

export function generationIdentity(
  generation: Omit<AnalysisGeneration, 'id' | 'sequence'>,
  manifest: readonly FactShardReference[],
): AnalysisGenerationId

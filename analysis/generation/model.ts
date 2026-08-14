import type { FactShard, FactShardReference } from '../facts/index.ts'
import { validateFactShard } from '../facts/index.ts'
import type {
  AnalysisGenerationId,
  FactShardKey,
  ProducerId,
  ProjectUniverseId,
  SourceManifestId,
} from '../identity/index.ts'
import { deriveAnalysisId } from '../identity/index.ts'

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
  readonly name = 'TransactionError'
  readonly code: TransactionFailureCode

  constructor(
    code: TransactionFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
  }
}

export function generationIdentity(
  generation: Omit<AnalysisGeneration, 'id' | 'sequence'>,
  manifest: readonly FactShardReference[],
): AnalysisGenerationId {
  return deriveAnalysisId('generation', 'astrale.analysis.generation.v1', {
    universe: generation.universe,
    producer: generation.producer,
    sourceManifest: generation.sourceManifest,
    capabilities: sortedUnique(generation.capabilities),
    manifest: [...manifest].sort(byKey),
  })
}

export function validateFactTransaction(
  transaction: FactTransaction,
  current?: AnalysisGenerationId,
): readonly string[] {
  const diagnostics: string[] = []
  if (transaction.protocolVersion !== 1) diagnostics.push('PROTOCOL_UNSUPPORTED')
  if (transaction.base !== current) diagnostics.push('BASE_STALE')
  if (!Number.isSafeInteger(transaction.next.sequence) || transaction.next.sequence < 1) {
    diagnostics.push('GENERATION_SEQUENCE_INVALID')
  }
  if (!transaction.next.producer.name || !transaction.next.producer.version) {
    diagnostics.push('GENERATION_PRODUCER_INVALID')
  }
  if (
    transaction.next.producer.protocolVersion !== transaction.protocolVersion ||
    !Number.isSafeInteger(transaction.next.producer.protocolVersion)
  ) {
    diagnostics.push('GENERATION_PROTOCOL_MISMATCH')
  }
  if (!isSortedUnique(transaction.next.capabilities)) diagnostics.push('CAPABILITY_ORDER_INVALID')
  if (!isSortedUnique(transaction.manifest.map((entry) => entry.key))) {
    diagnostics.push('MANIFEST_ORDER_INVALID')
  }
  if (!isSortedUnique(transaction.upserts.map((entry) => entry.key))) {
    diagnostics.push('UPSERT_ORDER_INVALID')
  }
  if (!isSortedUnique(transaction.deletes)) diagnostics.push('DELETE_ORDER_INVALID')
  const manifest = new Map(transaction.manifest.map((entry) => [entry.key, entry]))
  const deleted = new Set(transaction.deletes)
  for (const shard of transaction.upserts) {
    const issues = validateFactShard(shard)
    diagnostics.push(...issues.map((issue) => `SHARD:${shard.key}:${issue}`))
    const reference = manifest.get(shard.key)
    if (
      !reference ||
      reference.digest !== shard.digest ||
      reference.namespace !== shard.namespace ||
      reference.schemaVersion !== shard.schemaVersion ||
      reference.facts !== shard.facts.length
    ) {
      diagnostics.push(`MANIFEST_UPSERT_MISMATCH:${shard.key}`)
    }
    if (deleted.has(shard.key)) diagnostics.push(`UPSERT_DELETE_CONFLICT:${shard.key}`)
    if (shard.facts.some((fact) => fact.generation !== transaction.next.id)) {
      diagnostics.push(`SHARD_GENERATION_MISMATCH:${shard.key}`)
    }
  }
  for (const key of transaction.deletes) {
    if (manifest.has(key)) diagnostics.push(`DELETED_SHARD_IN_MANIFEST:${key}`)
  }
  const expectedId = generationIdentity(transaction.next, transaction.manifest)
  if (expectedId !== transaction.next.id) diagnostics.push('GENERATION_ID_MISMATCH')
  return [...new Set(diagnostics)].sort()
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || value.localeCompare(values[index - 1]!) > 0)
}

function byKey(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

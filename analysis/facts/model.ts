import type {
  AnalysisGenerationId,
  FactId,
  FactShardDigest,
  FactShardKey,
  PassId,
  SourceId,
  SourceRevisionId,
} from '../identity/index.ts'
import { deriveAnalysisId } from '../identity/index.ts'

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

export function factShardDigest(shard: Omit<FactShard, 'digest'>): FactShardDigest {
  const { digest: _digest, ...semantic } = shard as FactShard
  return deriveAnalysisId('fact-shard-digest', shard.namespace, {
    ...semantic,
    facts: shard.facts.map(({ generation: _generation, ...fact }) => fact),
  })
}

export function validateFactShard(shard: FactShard): readonly string[] {
  const diagnostics: string[] = []
  if (!shard.namespace.trim()) diagnostics.push('FACT_NAMESPACE_REQUIRED')
  if (!Number.isSafeInteger(shard.schemaVersion) || shard.schemaVersion < 1) {
    diagnostics.push('FACT_SCHEMA_VERSION_INVALID')
  }
  if (
    shard.capabilities &&
    (shard.capabilities.some((capability) => !capability.trim()) ||
      [...new Set(shard.capabilities)].sort().some(
        (capability, index) => capability !== shard.capabilities?.[index],
      ))
  ) diagnostics.push('FACT_SHARD_CAPABILITIES_INVALID')
  validateCompleteness(shard.completion, diagnostics, 'SHARD')
  const identities = new Set<string>()
  let previous = ''
  for (const fact of shard.facts) {
    if (identities.has(fact.id)) diagnostics.push(`FACT_ID_DUPLICATE:${fact.id}`)
    identities.add(fact.id)
    if (previous && fact.id.localeCompare(previous) <= 0) diagnostics.push('FACT_ORDER_INVALID')
    previous = fact.id
    if (fact.namespace !== shard.namespace) diagnostics.push(`FACT_NAMESPACE_MISMATCH:${fact.id}`)
    if (fact.schemaVersion !== shard.schemaVersion) diagnostics.push(`FACT_SCHEMA_MISMATCH:${fact.id}`)
    if (!fact.kind || !fact.subject) diagnostics.push(`FACT_SHAPE_INVALID:${fact.id}`)
    validateCompleteness(fact.completeness, diagnostics, `FACT:${fact.id}`)
    if (!fact.provenance.passVersion) diagnostics.push(`FACT_PRODUCER_VERSION_REQUIRED:${fact.id}`)
    for (const evidence of fact.provenance.evidence) {
      if (
        !Number.isSafeInteger(evidence.start) ||
        !Number.isSafeInteger(evidence.end) ||
        evidence.start < 0 ||
        evidence.end <= evidence.start
      ) {
        diagnostics.push(`FACT_EVIDENCE_RANGE_INVALID:${fact.id}`)
      }
    }
  }
  const expected = factShardDigest({
    key: shard.key,
    namespace: shard.namespace,
    schemaVersion: shard.schemaVersion,
    completion: shard.completion,
    facts: shard.facts,
    ...(shard.capabilities ? { capabilities: shard.capabilities } : {}),
  })
  if (shard.digest !== expected) {
    diagnostics.push(
      `FACT_SHARD_DIGEST_MISMATCH:expected=${expected}:actual=${shard.digest}:subjects=${[
        ...new Set(shard.facts.map((fact) => fact.subject)),
      ].join(',')}`,
    )
  }
  return [...new Set(diagnostics)].sort()
}

export function shardReference(shard: FactShard): FactShardReference {
  return {
    key: shard.key,
    digest: shard.digest,
    namespace: shard.namespace,
    schemaVersion: shard.schemaVersion,
    facts: shard.facts.length,
    ...(shard.capabilities ? { capabilities: shard.capabilities } : {}),
  }
}

function validateCompleteness(
  value: Completeness,
  diagnostics: string[],
  owner: string,
): void {
  if (value.kind === 'complete') return
  if (!value.reasons.length) diagnostics.push(`${owner}_COMPLETENESS_REASONS_REQUIRED`)
  for (const reason of value.reasons) {
    if (!reason.code || !reason.message) diagnostics.push(`${owner}_COMPLETENESS_REASON_INVALID`)
  }
}

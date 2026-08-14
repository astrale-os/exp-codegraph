import type { Completeness, Fact, FactShard } from '../../facts/index.ts'
import type { AnalysisGeneration } from '../../generation/index.ts'
import type {
  AnalysisGenerationId,
  FactId,
  FactShardDigest,
  FactShardKey,
  PassId,
  ProducerId,
  ProjectUniverseId,
  SourceId,
  SourceManifestId,
  SourceRevisionId,
} from '../../identity/index.ts'

import { stableJson } from '../../identity/model.ts'

export interface GenerationRow {
  readonly universe: string
  readonly sequence: number
  readonly generation_id: string
  readonly producer_id: string
  readonly producer_name: string
  readonly producer_version: string
  readonly protocol_version: number
  readonly source_manifest: string
  readonly capabilities_json: string
}

export interface ShardRow {
  readonly shard_digest: string
  readonly shard_key: string
  readonly fact_namespace: string
  readonly schema_version: number
  readonly completion_kind: Completeness['kind']
  readonly completion_json: string
  readonly capabilities_json: string
  readonly fact_count: number
}

export interface FactRow {
  readonly shard_digest: string
  readonly fact_id: string
  readonly fact_namespace: string
  readonly schema_version: number
  readonly kind: string
  readonly subject: string
  readonly completeness_kind: Completeness['kind']
  readonly completeness_json: string
  readonly pass_id: string
  readonly pass_version: string
  readonly payload_json: string
}

export interface EvidenceRow {
  readonly shard_digest: string
  readonly fact_id: string
  readonly ordinal: number
  readonly source_id: string
  readonly source_revision: string
  readonly start_offset: number
  readonly end_offset: number
}

export interface InputRow {
  readonly shard_digest: string
  readonly fact_id: string
  readonly ordinal: number
  readonly input_fact_id: string
}

export function generationFromRow(row: GenerationRow): AnalysisGeneration {
  const capabilities = parseJson(row.capabilities_json, 'generation capabilities')
  if (!Array.isArray(capabilities) || capabilities.some((entry) => typeof entry !== 'string')) {
    throw new TypeError('Persisted analysis generation capabilities are invalid.')
  }
  return immutable({
    id: row.generation_id as AnalysisGenerationId,
    sequence: row.sequence,
    universe: row.universe as ProjectUniverseId,
    producer: {
      id: row.producer_id as ProducerId,
      name: row.producer_name,
      version: row.producer_version,
      protocolVersion: row.protocol_version,
    },
    sourceManifest: row.source_manifest as SourceManifestId,
    capabilities,
  })
}

export function shardFromRows(row: ShardRow, facts: readonly Fact[]): FactShard {
  const completion = parseCompleteness(row.completion_json, row.completion_kind, 'shard')
  const capabilities = parseCapabilities(row.capabilities_json, 'shard capabilities')
  return immutable({
    key: row.shard_key as FactShardKey,
    digest: row.shard_digest as FactShardDigest,
    namespace: row.fact_namespace,
    schemaVersion: row.schema_version,
    completion,
    facts,
    ...(capabilities.length ? { capabilities } : {}),
  })
}

export function factFromRows(
  row: FactRow,
  generation: AnalysisGenerationId,
  evidence: readonly EvidenceRow[],
  inputs: readonly InputRow[],
): Fact {
  return immutable({
    id: row.fact_id as FactId,
    generation,
    namespace: row.fact_namespace,
    schemaVersion: row.schema_version,
    kind: row.kind,
    subject: row.subject,
    completeness: parseCompleteness(
      row.completeness_json,
      row.completeness_kind,
      `fact ${row.fact_id}`,
    ),
    provenance: {
      pass: row.pass_id as PassId,
      passVersion: row.pass_version,
      evidence: [...evidence]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((entry) => ({
          source: entry.source_id as SourceId,
          revision: entry.source_revision as SourceRevisionId,
          start: entry.start_offset,
          end: entry.end_offset,
        })),
      inputs: [...inputs]
        .sort((left, right) => left.ordinal - right.ordinal)
        .map((entry) => entry.input_fact_id as FactId),
    },
    payload: parseJson(row.payload_json, `fact ${row.fact_id} payload`),
  })
}

export function encodeJson(value: unknown): string {
  return stableJson(value)
}

export function parseJson(value: string, owner: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new TypeError(`Persisted ${owner} JSON is invalid.`, { cause: error })
  }
}

export function parseCapabilities(value: string, owner: string): readonly string[] {
  const parsed = parseJson(value, owner)
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== 'string' || !entry.trim()) ||
    [...new Set(parsed)].sort().some((entry, index) => entry !== parsed[index])
  ) throw new TypeError(`Persisted ${owner} are invalid.`)
  return parsed
}

function parseCompleteness(
  value: string,
  indexedKind: Completeness['kind'],
  owner: string,
): Completeness {
  const parsed = parseJson(value, `${owner} completeness`) as Completeness
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !['complete', 'partial', 'unavailable'].includes(parsed.kind) ||
    parsed.kind !== indexedKind
  ) {
    throw new TypeError(`Persisted ${owner} completeness is invalid.`)
  }
  if (parsed.kind !== 'complete' && !Array.isArray(parsed.reasons)) {
    throw new TypeError(`Persisted ${owner} completeness reasons are invalid.`)
  }
  return parsed
}

function immutable<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry)
  return Object.freeze(value)
}

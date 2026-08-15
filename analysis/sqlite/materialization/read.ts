import type { DatabaseSync } from 'node:sqlite'

import type { FactShardReference } from '../../facts/index.ts'
import type { AnalysisGeneration } from '../../generation/index.ts'
import type { AnalysisGenerationId, ProjectUniverseId } from '../../identity/index.ts'
import type { MaterializedGeneration } from '../../internal/state.ts'
import type { FactPayloadCodecMap } from '../../facts/representation/index.ts'
import { DEFAULT_SQLITE_ANALYSIS_LIMITS } from '../limits.ts'

import {
  factFromRows,
  generationFromRow,
  shardFromRows,
  type EvidenceRow,
  type FactRow,
  type GenerationRow,
  type InputRow,
  type ShardRow,
} from './model.ts'
import {
  loadShardPayloads,
  persistedFactPayload,
  SQLITE_INLINE_PAYLOAD_LAYOUT,
  SQLITE_SHARD_PAYLOAD_LAYOUT,
  ShardPayloadCache,
  validateShardPayloadMembership,
} from './payload.ts'

export function loadCurrentGeneration(
  database: DatabaseSync,
  storeNamespace: string,
  universe: ProjectUniverseId,
): AnalysisGeneration | undefined {
  const row = database
    .prepare(
      `SELECT generation.*
       FROM analysis_current AS current
       JOIN analysis_generations AS generation
         ON generation.store_namespace = current.store_namespace
        AND generation.universe = current.universe
        AND generation.sequence = current.generation_sequence
       WHERE current.store_namespace = ? AND current.universe = ?`,
    )
    .get(storeNamespace, universe) as GenerationRow | undefined
  return row ? generationFromRow(row) : undefined
}

export function loadGeneration(
  database: DatabaseSync,
  storeNamespace: string,
  universe: ProjectUniverseId,
  generation?: AnalysisGenerationId,
): AnalysisGeneration | undefined {
  const row = generation
    ? (database
        .prepare(
          `SELECT * FROM analysis_generations
           WHERE store_namespace = ? AND universe = ? AND generation_id = ?
           ORDER BY sequence DESC
           LIMIT 1`,
        )
        .get(storeNamespace, universe, generation) as GenerationRow | undefined)
    : undefined
  return generation
    ? row
      ? generationFromRow(row)
      : undefined
    : loadCurrentGeneration(database, storeNamespace, universe)
}

export function loadManifest(
  database: DatabaseSync,
  storeNamespace: string,
  universe: ProjectUniverseId,
  sequence: number,
): readonly FactShardReference[] {
  const rows = (
    database
      .prepare(
        `SELECT shard.shard_key AS key,
                shard.shard_digest AS digest,
                shard.fact_namespace AS namespace,
                shard.schema_version AS schemaVersion,
                shard.fact_count AS facts,
                shard.capabilities_json AS capabilitiesJson
         FROM analysis_generation_shards AS member
         JOIN analysis_shards AS shard
           ON shard.store_namespace = member.store_namespace
          AND shard.shard_digest = member.shard_digest
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?
         ORDER BY shard.shard_key`,
      )
      .all(storeNamespace, universe, sequence) as unknown as Array<
        Omit<FactShardReference, 'capabilities'> & { readonly capabilitiesJson: string }
      >
  )
  return rows.map(({ capabilitiesJson, ...row }) => {
    const capabilities = JSON.parse(capabilitiesJson) as readonly string[]
    return { ...row, ...(capabilities.length ? { capabilities } : {}) }
  })
}

/** Full reconstruction is reserved for migration, corruption audit, and tests. */
export function loadMaterializedGeneration(
  database: DatabaseSync,
  storeNamespace: string,
  generation: AnalysisGeneration,
  payloadCodecs: FactPayloadCodecMap,
  maximumDecompressedShardPayloadBytes =
    DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumDecompressedShardPayloadBytes,
): MaterializedGeneration {
  const shardRows = database
    .prepare(
      `SELECT shard.*
       FROM analysis_generation_shards AS member
       JOIN analysis_shards AS shard
         ON shard.store_namespace = member.store_namespace
        AND shard.shard_digest = member.shard_digest
       WHERE member.store_namespace = ?
         AND member.universe = ?
         AND member.generation_sequence = ?
       ORDER BY member.shard_key`,
    )
    .all(storeNamespace, generation.universe, generation.sequence) as unknown as ShardRow[]
  const shards = new Map(
    shardRows.map((row) => {
      assertShardPayloadLayout(database, storeNamespace, row)
      const factRows = database
        .prepare(
          `SELECT * FROM analysis_facts
           WHERE store_namespace = ? AND shard_digest = ?
           ORDER BY fact_id`,
        )
        .all(storeNamespace, row.shard_digest) as unknown as FactRow[]
      const evidenceRows = database
        .prepare(
          `SELECT * FROM analysis_fact_evidence
           WHERE store_namespace = ? AND shard_digest = ?
           ORDER BY fact_id, ordinal`,
        )
        .all(storeNamespace, row.shard_digest) as unknown as EvidenceRow[]
      const inputRows = database
        .prepare(
          `SELECT * FROM analysis_fact_inputs
           WHERE store_namespace = ? AND shard_digest = ?
           ORDER BY fact_id, ordinal`,
        )
        .all(storeNamespace, row.shard_digest) as unknown as InputRow[]
      const evidence = groupByFact(evidenceRows)
      const inputs = groupByFact(inputRows)
      const payloadRows = factRows.map((fact) => ({
        ...fact,
        payload_layout: row.payload_layout,
      }))
      const payloads = new ShardPayloadCache(maximumDecompressedShardPayloadBytes)
      loadShardPayloads(
        database,
        storeNamespace,
        payloadRows,
        payloads,
        maximumDecompressedShardPayloadBytes,
      )
      validateShardPayloadMembership(payloadRows, payloads)
      const facts = payloadRows.map((fact) =>
        factFromRows(
          fact,
          generation.id,
          evidence.get(fact.fact_id) ?? [],
          inputs.get(fact.fact_id) ?? [],
          persistedFactPayload(fact, payloads),
          payloadCodecs,
        ),
      )
      return [row.shard_key, shardFromRows(row, facts)] as const
    }),
  )
  return { generation, shards }
}

function assertShardPayloadLayout(
  database: DatabaseSync,
  storeNamespace: string,
  row: ShardRow,
): void {
  const payload = database
    .prepare(
      `SELECT 1 FROM analysis_shard_payloads
       WHERE store_namespace = ? AND shard_digest = ?`,
    )
    .get(storeNamespace, row.shard_digest)
  if (row.payload_layout === SQLITE_SHARD_PAYLOAD_LAYOUT && !payload) {
    throw new TypeError(`Persisted shard ${row.shard_digest} payload storage is missing.`)
  }
  if (row.payload_layout === SQLITE_INLINE_PAYLOAD_LAYOUT && payload) {
    throw new TypeError(`Persisted shard ${row.shard_digest} has extraneous payload storage.`)
  }
  if (
    row.payload_layout !== SQLITE_SHARD_PAYLOAD_LAYOUT &&
    row.payload_layout !== SQLITE_INLINE_PAYLOAD_LAYOUT
  ) throw new TypeError(`Persisted shard ${row.shard_digest} payload layout is unsupported.`)
}

function groupByFact<Row extends { readonly fact_id: string }>(
  rows: readonly Row[],
): ReadonlyMap<string, Row[]> {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) {
    const values = grouped.get(row.fact_id) ?? []
    values.push(row)
    grouped.set(row.fact_id, values)
  }
  return grouped
}

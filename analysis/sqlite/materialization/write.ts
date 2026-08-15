import type { DatabaseSync } from 'node:sqlite'

import type { FactShard } from '../../facts/index.ts'
import type { AnalysisGeneration, FactTransaction } from '../../generation/index.ts'
import type { MaterializedGeneration } from '../../internal/state.ts'
import { DEFAULT_SQLITE_ANALYSIS_LIMITS } from '../limits.ts'

import { encodeJson, type ShardRow } from './model.ts'
import {
  encodeShardPayloads,
  SQLITE_INLINE_PAYLOAD_LAYOUT,
  SQLITE_SHARD_PAYLOAD_LAYOUT,
  type PreparedShardPayload,
} from './payload.ts'

export function writeTransaction(
  database: DatabaseSync,
  storeNamespace: string,
  transaction: FactTransaction,
  payloads: ReadonlyMap<string, PreparedShardPayload>,
): void {
  writeGeneration(database, storeNamespace, transaction.next)
  for (const shard of transaction.upserts) {
    const payload = payloads.get(shard.digest)
    if (!payload) throw new Error(`Prepared payload is unavailable for shard ${shard.digest}.`)
    writeShard(database, storeNamespace, shard, payload)
  }
  const membership = database.prepare(
    `INSERT INTO analysis_generation_shards
      (store_namespace, universe, generation_sequence, shard_key, shard_digest)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const entry of transaction.manifest) {
    membership.run(
      storeNamespace,
      transaction.next.universe,
      transaction.next.sequence,
      entry.key,
      entry.digest,
    )
  }
  database
    .prepare(
      `INSERT INTO analysis_current
        (store_namespace, universe, generation_sequence)
       VALUES (?, ?, ?)
       ON CONFLICT(store_namespace, universe)
       DO UPDATE SET generation_sequence = excluded.generation_sequence`,
    )
    .run(storeNamespace, transaction.next.universe, transaction.next.sequence)
}

/** Used only to translate the retired snapshot-JSON prerelease schema. */
export function writeMaterializedGeneration(
  database: DatabaseSync,
  storeNamespace: string,
  materialized: MaterializedGeneration,
): void {
  writeGeneration(database, storeNamespace, materialized.generation)
  const membership = database.prepare(
    `INSERT INTO analysis_generation_shards
      (store_namespace, universe, generation_sequence, shard_key, shard_digest)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const shard of materialized.shards.values()) {
    writeShard(
      database,
      storeNamespace,
      shard,
      encodeShardPayloads(
        shard.facts,
        DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumDecompressedShardPayloadBytes,
      ),
    )
    membership.run(
      storeNamespace,
      materialized.generation.universe,
      materialized.generation.sequence,
      shard.key,
      shard.digest,
    )
  }
}

function writeGeneration(
  database: DatabaseSync,
  storeNamespace: string,
  generation: AnalysisGeneration,
): void {
  database
    .prepare(
      `INSERT INTO analysis_generations
        (store_namespace, universe, sequence, generation_id,
         producer_id, producer_name, producer_version, protocol_version,
         source_manifest, capabilities_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      storeNamespace,
      generation.universe,
      generation.sequence,
      generation.id,
      generation.producer.id,
      generation.producer.name,
      generation.producer.version,
      generation.producer.protocolVersion,
      generation.sourceManifest,
      encodeJson(generation.capabilities),
    )
}

function writeShard(
  database: DatabaseSync,
  storeNamespace: string,
  shard: FactShard,
  preparedPayloads: PreparedShardPayload,
): void {
  const payloadLayout = preparedPayloads.layout
  const existing = database
    .prepare(
      `SELECT * FROM analysis_shards
       WHERE store_namespace = ? AND shard_digest = ?`,
    )
    .get(storeNamespace, shard.digest) as ShardRow | undefined
  if (existing) {
    if (
      existing.shard_key !== shard.key ||
      existing.fact_namespace !== shard.namespace ||
      existing.schema_version !== shard.schemaVersion ||
      existing.completion_json !== encodeJson(shard.completion) ||
      existing.capabilities_json !== encodeJson(shard.capabilities ?? []) ||
      existing.fact_count !== shard.facts.length
    ) {
      throw new Error(`Content-addressed shard collision for ${shard.digest}.`)
    }
    return
  }
  database
    .prepare(
      `INSERT INTO analysis_shards
        (store_namespace, shard_digest, shard_key, fact_namespace, schema_version,
         completion_kind, completion_json, capabilities_json, fact_count, payload_layout)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      storeNamespace,
      shard.digest,
      shard.key,
      shard.namespace,
      shard.schemaVersion,
      shard.completion.kind,
      encodeJson(shard.completion),
      encodeJson(shard.capabilities ?? []),
      shard.facts.length,
      payloadLayout,
    )
  const factStatement = database.prepare(
    `INSERT INTO analysis_facts
      (store_namespace, shard_digest, fact_id, fact_namespace, schema_version,
       kind, subject, completeness_kind, completeness_json,
       pass_id, pass_version, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const evidenceStatement = database.prepare(
    `INSERT INTO analysis_fact_evidence
      (store_namespace, shard_digest, fact_id, ordinal, source_id,
       source_revision, start_offset, end_offset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const inputStatement = database.prepare(
    `INSERT INTO analysis_fact_inputs
      (store_namespace, shard_digest, fact_id, ordinal, input_fact_id)
     VALUES (?, ?, ?, ?, ?)`,
  )
  if (payloadLayout === SQLITE_SHARD_PAYLOAD_LAYOUT) {
    database
      .prepare(
        `INSERT INTO analysis_shard_payloads
          (store_namespace, shard_digest, encoding, payloads_blob)
         VALUES (?, ?, ?, ?)`,
      )
      .run(storeNamespace, shard.digest, preparedPayloads.encoding, preparedPayloads.payloads)
  }
  for (const [payloadOrdinal, fact] of shard.facts.entries()) {
    const payloadJson = payloadLayout === SQLITE_INLINE_PAYLOAD_LAYOUT
      ? (preparedPayloads as Extract<PreparedShardPayload, { readonly layout: typeof SQLITE_INLINE_PAYLOAD_LAYOUT }>).payloads[payloadOrdinal]
      : encodeJson(payloadOrdinal)
    if (payloadJson === undefined) {
      throw new Error(`Prepared inline payload is unavailable for fact ${fact.id}.`)
    }
    factStatement.run(
      storeNamespace,
      shard.digest,
      fact.id,
      fact.namespace,
      fact.schemaVersion,
      fact.kind,
      fact.subject,
      fact.completeness.kind,
      encodeJson(fact.completeness),
      fact.provenance.pass,
      fact.provenance.passVersion,
      payloadJson,
    )
    fact.provenance.evidence.forEach((evidence, ordinal) => {
      evidenceStatement.run(
        storeNamespace,
        shard.digest,
        fact.id,
        ordinal,
        evidence.source,
        evidence.revision,
        evidence.start,
        evidence.end,
      )
    })
    fact.provenance.inputs.forEach((input, ordinal) => {
      inputStatement.run(storeNamespace, shard.digest, fact.id, ordinal, input)
    })
  }
}

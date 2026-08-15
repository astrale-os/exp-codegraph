import type { DatabaseSync } from 'node:sqlite'

import { randomUUID } from 'node:crypto'

import type { FactId } from '../../identity/index.ts'
import type { FactPayloadCodecMap } from '../../facts/representation/index.ts'
import { validateFactTransaction } from '../../generation/index.ts'
import { encodeJson, generationFromRow, type GenerationRow } from '../materialization/model.ts'
import { loadManifest, loadMaterializedGeneration } from '../materialization/read.ts'

export function verifySQLiteAnalysisIntegrity(
  database: DatabaseSync,
  storeNamespace: string,
  payloadCodecs: FactPayloadCodecMap,
  maximumDecompressedShardPayloadBytes: number,
): readonly string[] {
  const integrity = database.prepare('PRAGMA quick_check').all() as {
    readonly quick_check: string
  }[]
  if (integrity.some((row) => row.quick_check !== 'ok')) {
    throw new Error(`Analysis SQLite integrity check failed: ${JSON.stringify(integrity)}`)
  }
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeys.length) {
    throw new Error(`Analysis SQLite foreign-key check failed: ${JSON.stringify(foreignKeys)}`)
  }

  const generations = database
    .prepare(
      `SELECT * FROM analysis_generations
       WHERE store_namespace = ?
       ORDER BY universe, sequence`,
    )
    .all(storeNamespace) as unknown as GenerationRow[]
  const invalid: {
    readonly row: GenerationRow
    readonly generationJson: string
    readonly manifestJson: string
    readonly reason: string
  }[] = []
  for (const row of generations) {
    let generationJson = '{}'
    let manifestJson = '[]'
    try {
      const generation = generationFromRow(row)
      generationJson = encodeJson(generation)
      const manifest = loadManifest(
        database,
        storeNamespace,
        generation.universe,
        generation.sequence,
      )
      manifestJson = encodeJson(manifest)
      const materialized = loadMaterializedGeneration(
        database,
        storeNamespace,
        generation,
        payloadCodecs,
        maximumDecompressedShardPayloadBytes,
      )
      const diagnostics = [...validateFactTransaction({
        protocolVersion: generation.producer.protocolVersion,
        next: generation,
        manifest,
        upserts: [...materialized.shards.values()],
        deletes: [],
      })]
      const identities = new Set<FactId>()
      for (const shard of materialized.shards.values()) {
        for (const fact of shard.facts) {
          if (identities.has(fact.id)) diagnostics.push(`FACT_ID_DUPLICATE:${fact.id}`)
          identities.add(fact.id)
        }
      }
      for (const shard of materialized.shards.values()) {
        for (const fact of shard.facts) {
          for (const input of fact.provenance.inputs) {
            if (!identities.has(input)) diagnostics.push(`FACT_INPUT_UNAVAILABLE:${fact.id}:${input}`)
          }
        }
      }
      if (diagnostics.length) throw new Error([...new Set(diagnostics)].sort().join(', '))
    } catch (error) {
      invalid.push({
        row,
        generationJson,
        manifestJson,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (!invalid.length) return []

  database.exec('BEGIN IMMEDIATE')
  try {
    const insert = database.prepare(
      `INSERT INTO analysis_quarantine
        (quarantine_id, store_namespace, universe, generation_id, sequence,
         generation_json, manifest_json, reason, quarantined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const remove = database.prepare(
      `DELETE FROM analysis_generations
       WHERE store_namespace = ? AND universe = ? AND sequence = ?`,
    )
    for (const entry of invalid) {
      insert.run(
        randomUUID(),
        storeNamespace,
        entry.row.universe,
        entry.row.generation_id,
        entry.row.sequence,
        entry.generationJson,
        entry.manifestJson,
        entry.reason,
        Date.now(),
      )
      remove.run(storeNamespace, entry.row.universe, entry.row.sequence)
    }
    deleteOrphanedShards(database, storeNamespace)
    database.exec('COMMIT')
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
  }
  return invalid.map((entry) => `${entry.row.universe}@${entry.row.sequence}`)
}

export function deleteOrphanedShards(database: DatabaseSync, storeNamespace: string): void {
  database
    .prepare(
      `DELETE FROM analysis_shards
       WHERE store_namespace = ?
         AND NOT EXISTS (
           SELECT 1
           FROM analysis_generation_shards AS member
           WHERE member.store_namespace = analysis_shards.store_namespace
             AND member.shard_digest = analysis_shards.shard_digest
         )`,
    )
    .run(storeNamespace)
}

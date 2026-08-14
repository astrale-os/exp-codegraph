import type { DatabaseSync } from 'node:sqlite'

import type { FactId } from '../../identity/index.ts'

import { shardReference, type FactShardReference } from '../../facts/index.ts'
import {
  TransactionError,
  validateFactTransaction,
  type FactTransaction,
} from '../../generation/index.ts'
import { stableJson } from '../../identity/model.ts'
import { loadCurrentGeneration, loadManifest } from './read.ts'

export interface ValidatedTransaction {
  readonly currentSequence?: number
  readonly manifest: readonly FactShardReference[]
}

/**
 * Validate a delta against indexed current membership. Unchanged shards are
 * never inflated into one in-memory snapshot.
 */
export function validateSQLiteTransaction(
  database: DatabaseSync,
  storeNamespace: string,
  transaction: FactTransaction,
): ValidatedTransaction {
  const current = loadCurrentGeneration(database, storeNamespace, transaction.next.universe)
  const diagnostics = [...validateFactTransaction(transaction, current?.id)]
  const expectedSequence = (current?.sequence ?? 0) + 1
  if (transaction.next.sequence !== expectedSequence) {
    diagnostics.push(
      `GENERATION_SEQUENCE_STALE:expected=${expectedSequence}:actual=${transaction.next.sequence}`,
    )
  }
  if (current && current.universe !== transaction.next.universe) {
    diagnostics.push('GENERATION_UNIVERSE_MISMATCH')
  }
  if (diagnostics.length) failValidation(diagnostics)

  const materialized = new Map(
    current
      ? loadManifest(database, storeNamespace, current.universe, current.sequence).map((entry) => [
          entry.key,
          entry,
        ])
      : [],
  )
  for (const key of transaction.deletes) {
    if (!materialized.delete(key)) {
      throw new TransactionError('MANIFEST_INVALID', `Unknown delete ${key}.`)
    }
  }
  for (const shard of transaction.upserts) {
    materialized.set(shard.key, shardReference(shard))
  }
  const actual = [...materialized.values()].sort(byKey)
  if (stableJson(actual) !== stableJson(transaction.manifest)) {
    throw new TransactionError(
      'MANIFEST_INVALID',
      'The transaction manifest is not the complete materialized next generation.',
    )
  }

  validateFactClosure(database, storeNamespace, transaction, current?.sequence)
  return { currentSequence: current?.sequence, manifest: actual }
}

function validateFactClosure(
  database: DatabaseSync,
  storeNamespace: string,
  transaction: FactTransaction,
  currentSequence: number | undefined,
): void {
  const replaced = new Set<string>([
    ...transaction.deletes,
    ...transaction.upserts.map((shard) => shard.key),
  ])
  const facts = new Map<FactId, readonly FactId[]>()
  if (currentSequence !== undefined) {
    const rows = database
      .prepare(
        `SELECT member.shard_key, fact.fact_id, input.input_fact_id, input.ordinal
         FROM analysis_generation_shards AS member
         JOIN analysis_facts AS fact
           ON fact.store_namespace = member.store_namespace
          AND fact.shard_digest = member.shard_digest
         LEFT JOIN analysis_fact_inputs AS input
           ON input.store_namespace = fact.store_namespace
          AND input.shard_digest = fact.shard_digest
          AND input.fact_id = fact.fact_id
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?
         ORDER BY fact.fact_id, input.ordinal`,
      )
      .all(storeNamespace, transaction.next.universe, currentSequence) as {
      readonly shard_key: string
      readonly fact_id: FactId
      readonly input_fact_id: FactId | null
      readonly ordinal: number | null
    }[]
    for (const row of rows) {
      if (replaced.has(row.shard_key)) continue
      const inputs = facts.get(row.fact_id) ?? []
      if (row.input_fact_id !== null) {
        facts.set(row.fact_id, [...inputs, row.input_fact_id])
      } else if (!facts.has(row.fact_id)) {
        facts.set(row.fact_id, [])
      }
    }
  }
  for (const shard of transaction.upserts) {
    for (const fact of shard.facts) {
      if (facts.has(fact.id)) {
        throw new TransactionError(
          'SHARD_INVALID',
          `Fact identity ${fact.id} occurs in more than one materialized shard.`,
        )
      }
      facts.set(fact.id, fact.provenance.inputs)
    }
  }
  for (const [fact, inputs] of facts) {
    for (const input of inputs) {
      if (!facts.has(input)) {
        throw new TransactionError(
          'SHARD_INVALID',
          `Fact ${fact} names unavailable derivation input ${input}.`,
        )
      }
    }
  }
}

function failValidation(diagnostics: readonly string[]): never {
  const unique = [...new Set(diagnostics)].sort()
  const code = unique.includes('BASE_STALE') ? 'BASE_STALE' : 'TRANSACTION_ABORTED'
  throw new TransactionError(code, unique.join('\n'))
}

function byKey(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

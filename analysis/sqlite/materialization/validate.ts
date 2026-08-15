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
  const replaced = [...new Set<string>([
    ...transaction.deletes,
    ...transaction.upserts.map((shard) => shard.key),
  ])].sort()
  const facts = new Map<FactId, readonly FactId[]>()
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
  if (currentSequence === undefined) {
    for (const [fact, inputs] of facts) {
      for (const input of inputs) {
        if (!facts.has(input)) unavailableInput(fact, input)
      }
    }
    return
  }

  const exclusion = replaced.length
    ? `AND member.shard_key NOT IN (${replaced.map(() => '?').join(', ')})`
    : ''
  const unaffectedFact = database.prepare(
    `SELECT 1
     FROM analysis_generation_shards AS member
     JOIN analysis_facts AS fact
       ON fact.store_namespace = member.store_namespace
      AND fact.shard_digest = member.shard_digest
     WHERE member.store_namespace = ?
       AND member.universe = ?
       AND member.generation_sequence = ?
       ${exclusion}
       AND fact.fact_id = ?
     LIMIT 1`,
  )
  const currentArguments = [
    storeNamespace,
    transaction.next.universe,
    currentSequence,
    ...replaced,
  ] as const
  for (const [fact, inputs] of facts) {
    if (unaffectedFact.get(...currentArguments, fact)) {
      throw new TransactionError(
        'SHARD_INVALID',
        `Fact identity ${fact} occurs in more than one materialized shard.`,
      )
    }
    for (const input of inputs) {
      if (!facts.has(input) && !unaffectedFact.get(...currentArguments, input)) {
        unavailableInput(fact, input)
      }
    }
  }

  if (!replaced.length) return
  const replacedFacts = database
    .prepare(
      `SELECT fact.fact_id
       FROM analysis_generation_shards AS member
       JOIN analysis_facts AS fact
         ON fact.store_namespace = member.store_namespace
        AND fact.shard_digest = member.shard_digest
       WHERE member.store_namespace = ?
         AND member.universe = ?
         AND member.generation_sequence = ?
         AND member.shard_key IN (${replaced.map(() => '?').join(', ')})`,
    )
    .all(...currentArguments) as unknown as { readonly fact_id: FactId }[]
  const unaffectedConsumer = database.prepare(
    `SELECT input.fact_id
     FROM analysis_generation_shards AS member
     JOIN analysis_fact_inputs AS input
       ON input.store_namespace = member.store_namespace
      AND input.shard_digest = member.shard_digest
     WHERE member.store_namespace = ?
       AND member.universe = ?
       AND member.generation_sequence = ?
       ${exclusion}
       AND input.input_fact_id = ?
     LIMIT 1`,
  )
  for (const removed of replacedFacts) {
    if (facts.has(removed.fact_id)) continue
    const consumer = unaffectedConsumer.get(...currentArguments, removed.fact_id) as
      | { readonly fact_id: FactId }
      | undefined
    if (consumer) unavailableInput(consumer.fact_id, removed.fact_id)
  }
}

function unavailableInput(fact: FactId, input: FactId): never {
  throw new TransactionError(
    'SHARD_INVALID',
    `Fact ${fact} names unavailable derivation input ${input}.`,
  )
}

function failValidation(diagnostics: readonly string[]): never {
  const unique = [...new Set(diagnostics)].sort()
  const code = unique.includes('BASE_STALE') ? 'BASE_STALE' : 'TRANSACTION_ABORTED'
  throw new TransactionError(code, unique.join('\n'))
}

function byKey(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

import type { FactShardReference } from '../facts/index.ts'
import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts'
import { validateFactTransaction } from '../generation/index.ts'
import type { ProjectUniverseId } from '../identity/index.ts'
import type { AnalysisStore } from '../query/index.ts'

export interface MaterializedNativeTransaction {
  readonly generation: AnalysisGeneration
  readonly transaction?: FactTransaction
  readonly rollover: boolean
}

/**
 * Admit one compiler transaction while preserving universe lineage semantics.
 *
 * A native universe rollover is deliberately emitted as a complete, base-less
 * snapshot. If that portable universe existed before (for example after a
 * tsconfig edit is reverted), this function safely rebases the complete
 * snapshot onto the caller's retained current generation for that universe.
 */
export async function materializeNativeTransaction(
  store: AnalysisStore,
  activeUniverse: ProjectUniverseId | undefined,
  activeGeneration: AnalysisGeneration | undefined,
  transaction: FactTransaction,
  options: { readonly signal?: AbortSignal } = {},
): Promise<MaterializedNativeTransaction> {
  const rollover = transaction.next.universe !== activeUniverse
  if (!rollover) {
    assertTransaction(transaction, activeGeneration?.id)
    await store.commit(transaction, options)
    return { generation: transaction.next, transaction, rollover: false }
  }

  assertCompleteRollover(transaction)
  assertTransaction(transaction, undefined)
  const destination = await store.current(transaction.next.universe)
  if (!destination) {
    await store.commit(transaction, options)
    return { generation: transaction.next, transaction, rollover: true }
  }
  if (destination.id === transaction.next.id) {
    return { generation: destination, rollover: true }
  }

  const currentManifest = await readManifest(store, destination)
  const nextKeys = new Set(transaction.manifest.map((reference) => reference.key))
  const rebased: FactTransaction = {
    ...transaction,
    base: destination.id,
    next: { ...transaction.next, sequence: destination.sequence + 1 },
    deletes: currentManifest
      .filter((reference) => !nextKeys.has(reference.key))
      .map((reference) => reference.key)
      .sort(),
  }
  assertTransaction(rebased, destination.id)
  await store.commit(rebased, options)
  return { generation: rebased.next, transaction: rebased, rollover: true }
}

function assertCompleteRollover(transaction: FactTransaction): void {
  if (transaction.base !== undefined || transaction.deletes.length !== 0) {
    throw new Error('A native universe rollover must be a complete base-less transaction.')
  }
  const manifest = new Map(transaction.manifest.map((reference) => [reference.key, reference]))
  if (
    transaction.upserts.length !== manifest.size ||
    transaction.upserts.some((shard) => manifest.get(shard.key)?.digest !== shard.digest)
  ) {
    throw new Error('A native universe rollover omitted materialized shards from its manifest.')
  }
}

function assertTransaction(
  transaction: FactTransaction,
  current: AnalysisGeneration['id'] | undefined,
): void {
  const diagnostics = validateFactTransaction(transaction, current)
  if (diagnostics.length) {
    throw new Error(`Native analysis returned an invalid transaction:\n${diagnostics.join('\n')}`)
  }
}

async function readManifest(
  store: AnalysisStore,
  generation: AnalysisGeneration,
): Promise<readonly FactShardReference[]> {
  const query = await store.open(generation.universe, generation.id)
  try {
    return await query.manifest()
  } finally {
    await query.dispose()
  }
}

import type { DatabaseSync } from 'node:sqlite'

import type { ProjectUniverseId } from '../../identity/index.ts'

import { deleteOrphanedShards } from '../schema/integrity.ts'

export function collectSQLiteGenerations(
  database: DatabaseSync,
  storeNamespace: string,
  universe: ProjectUniverseId,
  maximumRetained: number,
): void {
  const now = Date.now()
  database
    .prepare('DELETE FROM analysis_leases WHERE store_namespace = ? AND expires_at <= ?')
    .run(storeNamespace, now)
  const rows = database
    .prepare(
      `SELECT sequence FROM analysis_generations
       WHERE store_namespace = ? AND universe = ?
       ORDER BY sequence DESC`,
    )
    .all(storeNamespace, universe) as { readonly sequence: number }[]
  const retained = new Set(rows.slice(0, maximumRetained).map((row) => row.sequence))
  const leased = database
    .prepare(
      `SELECT generation_sequence AS sequence
       FROM analysis_leases
       WHERE store_namespace = ? AND universe = ? AND expires_at > ?`,
    )
    .all(storeNamespace, universe, now) as { readonly sequence: number }[]
  for (const row of leased) retained.add(row.sequence)
  const remove = database.prepare(
    `DELETE FROM analysis_generations
     WHERE store_namespace = ? AND universe = ? AND sequence = ?`,
  )
  for (const row of rows) {
    if (!retained.has(row.sequence)) remove.run(storeNamespace, universe, row.sequence)
  }
  deleteOrphanedShards(database, storeNamespace)
}

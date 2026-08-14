import type { AnalysisStore } from '../../query/.spec/api.js'

export interface SQLiteAnalysisStoreOptions {
  readonly file: string
  readonly namespace: string
  readonly busyTimeoutMs?: number
  readonly leaseTimeoutMs?: number
  readonly maximumRetainedGenerations?: number
  readonly requireDurability?: boolean
}

/** Open a regenerable SQLite materializer implementing the generic store contract. */
export function createSQLiteAnalysisStore(
  options: SQLiteAnalysisStoreOptions,
): Promise<AnalysisStore>

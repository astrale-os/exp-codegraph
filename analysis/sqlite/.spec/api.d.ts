import type { AnalysisStore } from '../../query/.spec/api.js'
import type { AnalysisTelemetrySink } from '../../profiling/.spec/api.js'
import type { FactPayloadCodec } from '../../facts/representation/.spec/api.js'

export type SQLitePayloadMaterialization = 'inline-json' | 'shard-brotli'

export const DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION: SQLitePayloadMaterialization

export interface SQLiteAnalysisStoreOptions {
  readonly file: string
  readonly namespace: string
  readonly busyTimeoutMs?: number
  readonly leaseTimeoutMs?: number
  readonly maximumRetainedGenerations?: number
  readonly requireDurability?: boolean
  readonly telemetry?: AnalysisTelemetrySink
  /** Private physical payloads explicitly supported by this materializer. */
  readonly payloadCodecs?: readonly FactPayloadCodec[]
  /** Physical materialization selected without changing semantic Fact identity or queries. */
  readonly payloadMaterialization?: SQLitePayloadMaterialization
  /** Maximum decoded bytes admitted for one immutable shard payload. */
  readonly maximumDecompressedShardPayloadBytes?: number
  /** Maximum decoded shard payload bytes retained by one pinned query. */
  readonly maximumCachedShardPayloadBytes?: number
}

export const DEFAULT_SQLITE_ANALYSIS_LIMITS: Readonly<{
  readonly maximumDecompressedShardPayloadBytes: number
  readonly maximumCachedShardPayloadBytes: number
}>

/** Open a regenerable SQLite materializer implementing the generic store contract. */
export function createSQLiteAnalysisStore(
  options: SQLiteAnalysisStoreOptions,
): Promise<AnalysisStore>

export type SQLitePayloadMaterialization = 'inline-json' | 'shard-brotli'

export const DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION: SQLitePayloadMaterialization =
  'inline-json'

export const DEFAULT_SQLITE_ANALYSIS_LIMITS = Object.freeze({
  maximumDecompressedShardPayloadBytes: 64 * 1_024 * 1_024,
  maximumCachedShardPayloadBytes: 64 * 1_024 * 1_024,
})

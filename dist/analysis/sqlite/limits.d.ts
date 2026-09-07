export type SQLitePayloadMaterialization = 'inline-json' | 'shard-brotli';
export declare const DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION: SQLitePayloadMaterialization;
export declare const DEFAULT_SQLITE_ANALYSIS_LIMITS: Readonly<{
    maximumDecompressedShardPayloadBytes: number;
    maximumCachedShardPayloadBytes: number;
}>;

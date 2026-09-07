import type { AnalysisStore } from '../query/index.ts';
import type { AnalysisTelemetrySink } from '../profiling/index.ts';
import { type FactPayloadCodec } from '../facts/representation/index.ts';
import { type SQLitePayloadMaterialization } from './limits.ts';
export interface SQLiteAnalysisStoreOptions {
    readonly file: string;
    readonly namespace: string;
    readonly busyTimeoutMs?: number;
    readonly leaseTimeoutMs?: number;
    readonly maximumRetainedGenerations?: number;
    readonly requireDurability?: boolean;
    readonly telemetry?: AnalysisTelemetrySink;
    /** Private physical payloads explicitly supported by this materializer. */
    readonly payloadCodecs?: readonly FactPayloadCodec[];
    readonly payloadMaterialization?: SQLitePayloadMaterialization;
    readonly maximumDecompressedShardPayloadBytes?: number;
    readonly maximumCachedShardPayloadBytes?: number;
}
export declare function createSQLiteAnalysisStore(options: SQLiteAnalysisStoreOptions): Promise<AnalysisStore>;

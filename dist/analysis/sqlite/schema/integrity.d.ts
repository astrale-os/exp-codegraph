import type { DatabaseSync } from 'node:sqlite';
import type { FactPayloadCodecMap } from '../../facts/representation/index.ts';
export declare function verifySQLiteAnalysisIntegrity(database: DatabaseSync, storeNamespace: string, payloadCodecs: FactPayloadCodecMap, maximumDecompressedShardPayloadBytes: number): readonly string[];
export declare function deleteOrphanedShards(database: DatabaseSync, storeNamespace: string): void;

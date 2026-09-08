import type { DatabaseSync } from 'node:sqlite';
import type { Fact } from '../../facts/index.ts';
import { type StoredFactPayload } from '../../facts/representation/index.ts';
import type { SQLitePayloadMaterialization } from '../limits.ts';
import { type FactRow } from './model.ts';
export declare const SQLITE_INLINE_PAYLOAD_LAYOUT = "inline-json/1";
export declare const SQLITE_SHARD_PAYLOAD_LAYOUT = "shard-ordinal/1";
export declare const SQLITE_SHARD_PAYLOAD_ENCODING = "brotli-stored-payloads/2";
export interface ShardPayloadRow {
    readonly shard_digest: string;
    readonly encoding: string;
    readonly payloads_blob: Uint8Array;
}
export type PreparedShardPayload = {
    readonly layout: typeof SQLITE_SHARD_PAYLOAD_LAYOUT;
    readonly encoding: string;
    readonly payloads: Uint8Array;
    readonly decompressedBytes: number;
} | {
    readonly layout: typeof SQLITE_INLINE_PAYLOAD_LAYOUT;
    readonly payloads: readonly string[];
    readonly decompressedBytes: number;
};
interface DecodedShardPayloads {
    readonly payloads: readonly unknown[];
    readonly bytes: number;
    readonly storedRecords: boolean;
}
type PayloadFactRow = Pick<FactRow, 'fact_id' | 'shard_digest' | 'payload_json'> & {
    readonly payload_layout: string;
};
export declare class ShardPayloadCache {
    #private;
    constructor(maximumBytes: number);
    has(digest: string): boolean;
    get(digest: string): DecodedShardPayloads | undefined;
    set(digest: string, value: DecodedShardPayloads | undefined): void;
}
export declare function encodeShardPayloads(facts: readonly Fact[], maximumDecompressedBytes: number): Extract<PreparedShardPayload, {
    readonly layout: typeof SQLITE_SHARD_PAYLOAD_LAYOUT;
}>;
export declare function prepareShardPayloads(shards: readonly {
    readonly digest: string;
    readonly facts: readonly Fact[];
}[], maximumDecompressedBytes: number, materialization: SQLitePayloadMaterialization): ReadonlyMap<string, PreparedShardPayload>;
export declare function loadShardPayloads(database: DatabaseSync, storeNamespace: string, rows: readonly PayloadFactRow[], cache: ShardPayloadCache, maximumDecompressedBytes: number): void;
export declare function persistedFactPayload(row: PayloadFactRow, cache: ShardPayloadCache): StoredFactPayload;
/** Verify that one compact shard blob owns exactly one payload per fact row. */
export declare function validateShardPayloadMembership(rows: readonly PayloadFactRow[], cache: ShardPayloadCache): void;
export declare function decodeShardPayloads(row: ShardPayloadRow, maximumDecompressedBytes: number): DecodedShardPayloads;
export {};

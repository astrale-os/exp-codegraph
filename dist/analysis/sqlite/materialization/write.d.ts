import type { DatabaseSync } from 'node:sqlite';
import type { FactTransaction } from '../../generation/index.ts';
import type { MaterializedGeneration } from '../../internal/state.ts';
import { type PreparedShardPayload } from './payload.ts';
export declare function writeTransaction(database: DatabaseSync, storeNamespace: string, transaction: FactTransaction, payloads: ReadonlyMap<string, PreparedShardPayload>): void;
/** Used only to translate the retired snapshot-JSON prerelease schema. */
export declare function writeMaterializedGeneration(database: DatabaseSync, storeNamespace: string, materialized: MaterializedGeneration): void;

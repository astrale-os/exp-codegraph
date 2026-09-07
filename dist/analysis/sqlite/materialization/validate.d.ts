import type { DatabaseSync } from 'node:sqlite';
import { type FactShardReference } from '../../facts/index.ts';
import { type FactTransaction } from '../../generation/index.ts';
export interface ValidatedTransaction {
    readonly currentSequence?: number;
    readonly manifest: readonly FactShardReference[];
}
/**
 * Recheck only the causal base after acquiring the writer lock. The complete
 * transaction was admitted synchronously immediately before BEGIN IMMEDIATE;
 * immutable shards cannot change while this connection waits for that lock.
 */
export declare function validateSQLiteTransactionBase(database: DatabaseSync, storeNamespace: string, transaction: FactTransaction, expectedCurrentSequence: number | undefined): void;
/**
 * Validate a delta against indexed current membership. Unchanged shards are
 * never inflated into one in-memory snapshot.
 */
export declare function validateSQLiteTransaction(database: DatabaseSync, storeNamespace: string, transaction: FactTransaction): ValidatedTransaction;

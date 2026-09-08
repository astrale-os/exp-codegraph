import type { FactShard, FactShardReference } from '../facts/index.ts';
import type { FactTransaction } from '../generation/index.ts';
import type { FactShardKey } from '../identity/index.ts';
type TransactionHeader = Pick<FactTransaction, 'protocolVersion' | 'base' | 'next'>;
interface RecordAdmission {
    header(input: unknown): TransactionHeader;
    reference(input: unknown): FactShardReference;
    shard(input: unknown): FactShard;
    deletion(input: unknown): FactShardKey;
}
/**
 * Private wire staging. Complete records are admitted immediately; their encoded
 * bytes are released before the next record. Nothing is published until finish
 * and the enclosing stream's length, order and digest have all been verified.
 */
export declare class TransactionRecordDecoder {
    #private;
    constructor(maximumRecordBytes: number, admission: RecordAdmission);
    append(bytes: Uint8Array): void;
    finish(): FactTransaction;
    private retain;
    private record;
}
export {};

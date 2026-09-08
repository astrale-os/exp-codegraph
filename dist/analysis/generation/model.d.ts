import type { FactShard, FactShardReference } from '../facts/index.ts';
import type { AnalysisGenerationId, FactShardKey } from '../identity/index.ts';
import type { AnalysisGeneration } from './types.ts';
export type { AnalysisGeneration, ProducerIdentity } from './types.ts';
export interface FactTransaction {
    readonly protocolVersion: number;
    readonly base?: AnalysisGenerationId;
    readonly next: AnalysisGeneration;
    readonly manifest: readonly FactShardReference[];
    readonly upserts: readonly FactShard[];
    readonly deletes: readonly FactShardKey[];
}
export type TransactionFailureCode = 'PROTOCOL_UNSUPPORTED' | 'BASE_STALE' | 'GENERATION_INVALID' | 'MANIFEST_INVALID' | 'SHARD_INVALID' | 'TRANSACTION_ABORTED';
export declare class TransactionError extends Error {
    readonly name = "TransactionError";
    readonly code: TransactionFailureCode;
    constructor(code: TransactionFailureCode, message: string, options?: ErrorOptions);
}
export declare function generationIdentity(generation: Omit<AnalysisGeneration, 'id' | 'sequence'>, manifest: readonly FactShardReference[]): AnalysisGenerationId;
export declare function validateFactTransaction(transaction: FactTransaction, current?: AnalysisGenerationId): readonly string[];

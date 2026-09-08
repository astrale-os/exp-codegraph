import type { EvaluatedValueResult } from '../model.ts';
/** One resident project owns this bounded LRU across every model and budget. */
export declare class ValueResolutionCache {
    #private;
    constructor(maximumEntries?: number, maximumBytes?: number);
    model(model: object | undefined): number;
    get(key: string, valid: (result: EvaluatedValueResult<unknown>) => boolean): EvaluatedValueResult<unknown> | undefined;
    put(key: string, result: EvaluatedValueResult<unknown>, bytes: number): void;
    close(): void;
    get size(): number;
    get bytes(): number;
}
/** Estimate owned storage only for deeply immutable, portable result graphs. */
export declare function resolutionResultBytes(input: unknown): number | undefined;

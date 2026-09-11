import type { EvaluatedValueResult } from '../model.ts';
import type { FactId } from '../../../identity/index.ts';
import type { ValueIndexRevision } from './facts.ts';
export type { ValueIndexRevision } from './facts.ts';
export interface ValueDependency {
    readonly key: string;
    readonly fingerprint: string | undefined;
}
export interface ValueProofBasis {
    readonly key: string;
    readonly dependencies: readonly ValueDependency[];
    readonly evidence: readonly FactId[];
    readonly limits: EvaluatedValueResult<unknown>['limits'];
}
/** Project-owned, byte-bounded admission and invalidation across models and budgets. */
export declare class ValueResolutionCache {
    #private;
    constructor(maximumEntries?: number, maximumBytes?: number);
    model(model: object | undefined): number;
    dependency(witness: ValueDependency): ValueDependency;
    /** Aggregate computations share this cache's existing retention envelope. */
    reserve(bytes: number): (() => void) | undefined;
    /** Only resident bases are interned; rejected demands add no retained registry entry. */
    basis(dependencies: Iterable<ValueDependency>, evidence: readonly FactId[], limits: ValueProofBasis['limits']): ValueProofBasis;
    get(key: string, valid: (result: EvaluatedValueResult<unknown>) => boolean, revision?: ValueIndexRevision): EvaluatedValueResult<unknown> | undefined;
    put(key: string, result: EvaluatedValueResult<unknown>, bytes: number, basis?: ValueProofBasis): void;
    private advance;
    private remove;
    private clear;
    close(): void;
    get size(): number;
    get capacity(): number;
    get bytes(): number;
}
/** Estimate owned storage only for deeply immutable, portable result graphs. */
export declare function resolutionResultBytes(input: unknown, shared?: readonly object[]): number | undefined;

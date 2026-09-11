import type { AnalysisQuery } from '../../../query/index.ts';
import type { TypeScriptCallInventory, TypeScriptCallQuery } from '../../body/index.ts';
import { type ValueIndex as Index } from './facts.ts';
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions } from '../model.ts';
import { type ValueIndexRevision, type ValueProofBasis, type ValueResolutionCache } from './cache.ts';
/** Instance-local index owner, shared by every model attached to one pinned snapshot. */
interface ValueEvaluatorFactory {
    <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>): Promise<BoundedValueEvaluator<Atom>>;
    calls(options?: TypeScriptCallQuery): Promise<TypeScriptCallInventory>;
    dispose(): void;
}
/** Explicitly scoped collection; independent computations share no ambient state. */
export interface ValueReadScope {
    readonly signal?: AbortSignal;
    check(): void;
    fail(): void;
    proof(basis: ValueProofBasis): void;
    selection(revision: ValueIndexRevision | undefined, keys: readonly string[]): void;
}
export declare function createValueEvaluatorFactory(query: AnalysisQuery, cache?: ValueResolutionCache, load?: () => Promise<Index>, scope?: ValueReadScope): ValueEvaluatorFactory;
export {};

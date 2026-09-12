import type { AnalysisGeneration } from '../../generation/index.ts';
import type { AnalysisQuery } from '../../query/index.ts';
import type { ValueIndex } from '../value/symbolic/facts.ts';
import type { ValueResolutionCache } from '../value/symbolic/cache.ts';
import type { TypeScriptComputation } from './model.ts';
/** One project-owned admission policy, with no callback or snapshot retained. */
export declare class SemanticComputationCache {
    #private;
    constructor(values: ValueResolutionCache);
    committed(generation: AnalysisGeneration): void;
    run<Input, Result>(query: AnalysisQuery, load: () => Promise<ValueIndex>, observe: TypeScriptComputation<Input, Result>, input: Input, check: () => void, signal?: AbortSignal): Promise<Result>;
    private reconcile;
    private get;
    private reserve;
    private remove;
    close(): void;
}

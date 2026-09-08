import type { ApiCompilation, CompileApiOptions } from './compile.ts';
/**
 * Plan worker batches from semantic compatibility. Explicit caller batch bounds and any planner
 * uncertainty retain deterministic fixed-capacity fallback; aggregate overflow still recursively
 * splits through the canonical isolated path.
 */
export declare const API_COMPILER_OPTIMIZATION: {
    readonly fallbackMaximumBatchEntries: 32;
    readonly batchOutputExceeded: (results: readonly ApiCompilation[]) => boolean;
    readonly plan: (requests: readonly CompileApiOptions[], explicitMaximum?: number) => {
        readonly batches: readonly (readonly number[])[];
        readonly outcome: 'compatible' | 'explicit' | 'fallback' | 'diagnostics-universe';
    };
};

import type { ApiCompilation, CompileApiOptions } from './compile.ts';
export interface IsolatedCompileApiOptions extends CompileApiOptions {
    readonly timeoutMs?: number;
    readonly maxOldSpaceMegabytes?: number;
}
export interface IsolatedApiBatchOptions {
    /**
     * Explicit hard wall-clock deadline for one worker batch after it owns a worker slot.
     * When omitted, the default per-entrypoint budget scales with the bounded batch size.
     */
    readonly timeoutMs?: number;
    readonly maxOldSpaceMegabytes?: number;
    /** Maximum entrypoints compiled by one memory-bounded worker. */
    readonly maxBatchEntries?: number;
    /** Maximum serialized size of one compilation result, not of the complete batch. */
    readonly maxResultBytes?: number;
    /** Maximum serialized output retained for one complete worker batch. */
    readonly maxBatchResultBytes?: number;
}
/** Shared load and worker capacity; large enough to amortize one TypeScript project construction. */
export declare const API_COMPILER_BATCH_CAPACITY: 32;
/**
 * Compile an untrusted API in a disposable, memory-bounded process.
 *
 * The worker uses the bounded native declaration compiler; the process boundary adds a hard
 * deadline and prevents compiler memory exhaustion from taking down the specification server.
 */
export declare function compileApiIsolated(options: IsolatedCompileApiOptions): Promise<ApiCompilation>;
export declare function compileApisIsolated(options: readonly CompileApiOptions[], isolation?: IsolatedApiBatchOptions): Promise<readonly ApiCompilation[]>;

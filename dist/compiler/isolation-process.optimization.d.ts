import type { ApiCompilation, CompileApiOptions } from './compile.ts';
export interface ApiCompilerProcessOptions {
    readonly timeoutMs?: number;
    readonly maxOldSpaceMegabytes?: number;
    readonly maxResultBytes?: number;
    readonly maxBatchResultBytes?: number;
}
/** Execute one bounded declaration universe and admit its private result/resource protocol. */
export declare function compileApisInIsolatedWorker(options: readonly CompileApiOptions[], isolation: ApiCompilerProcessOptions): Promise<readonly ApiCompilation[]>;

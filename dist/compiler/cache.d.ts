import type { ApiCompiler } from './contract.ts';
export interface ApiCompilerCacheDependencies {
    read(file: string): Promise<string>;
    revision(text: string): string;
}
export interface ApiCompilerCacheOptions {
    readonly capacity?: number;
}
export interface CachedApiCompiler extends ApiCompiler {
    /** Reuse dependency revisions only within one logically coherent catalog read. */
    withRevisionSnapshot<T>(operation: () => Promise<T>): Promise<T>;
}
/** Add dependency-validated, bounded memoization without changing compiler semantics. */
export declare function createCachedApiCompiler(compiler: ApiCompiler, dependencies: ApiCompilerCacheDependencies, options?: ApiCompilerCacheOptions): CachedApiCompiler;

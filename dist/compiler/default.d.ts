declare const isolatedApiCompiler: import("./cache.ts").CachedApiCompiler;
/** Process-local declaration compiler and restorable cache lifecycle. */
export declare const defaultApiCompiler: import("./cache.ts").CachedApiCompiler;
/**
 * Normative declaration port over the isolated project/cache lifecycle.
 * V2 semantics are explicit so no caller can silently fall back to the retired V1 oracle.
 */
export declare const specificationApiCompiler: {
    compile(options: Parameters<typeof isolatedApiCompiler.compile>[0]): Promise<import("./compile.ts").ApiCompilation>;
};
export {};

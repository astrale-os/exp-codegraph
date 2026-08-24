/** Observe one actual Program construction while keeping instrumentation diagnostic-only. */
export function observeModuleTypeScriptProgram(observer, durationMs = 0) {
    observeModuleTypeScriptProjection(observer, 'program', durationMs, 1);
}
export function observeModuleTypeScriptProjection(observer, phase, durationMs, items) {
    try {
        observer?.({ phase, durationMs, items });
    }
    catch {
        // Diagnostic observation cannot change canonical compiler work.
    }
}
export function moduleTypeScriptProjectionObserver(observer) {
    return (phase, durationMs, items) => observeModuleTypeScriptProjection(observer, phase, durationMs, items);
}
//# sourceMappingURL=typescript-program.optimization.js.map
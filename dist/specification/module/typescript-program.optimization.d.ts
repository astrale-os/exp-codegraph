export interface ModuleTypeScriptProgramPhase {
    readonly phase: 'program';
    readonly durationMs: number;
    readonly items: number;
}
/** Observe one actual Program construction while keeping instrumentation diagnostic-only. */
export declare function observeModuleTypeScriptProgram(observer: ((phase: ModuleTypeScriptProgramPhase) => void) | undefined, durationMs?: number): void;
export declare function observeModuleTypeScriptProjection<Phase extends string>(observer: ((phase: {
    readonly phase: Phase;
    readonly durationMs: number;
    readonly items: number;
}) => void) | undefined, phase: Phase, durationMs: number, items: number): void;
export declare function moduleTypeScriptProjectionObserver<Phase extends string>(observer: ((phase: {
    readonly phase: Phase;
    readonly durationMs: number;
    readonly items: number;
}) => void) | undefined): (phase: Phase, durationMs: number, items: number) => void;

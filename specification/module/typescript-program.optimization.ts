export interface ModuleTypeScriptProgramPhase {
  readonly phase: 'program'
  readonly durationMs: number
  readonly items: number
}

/** Observe one actual Program construction while keeping instrumentation diagnostic-only. */
export function observeModuleTypeScriptProgram(
  observer: ((phase: ModuleTypeScriptProgramPhase) => void) | undefined,
  durationMs = 0,
): void {
  observeModuleTypeScriptProjection(observer, 'program', durationMs, 1)
}

export function observeModuleTypeScriptProjection<Phase extends string>(
  observer: ((phase: { readonly phase: Phase; readonly durationMs: number; readonly items: number }) => void) | undefined,
  phase: Phase,
  durationMs: number,
  items: number,
): void {
  try {
    observer?.({ phase, durationMs, items })
  } catch {
    // Diagnostic observation cannot change canonical compiler work.
  }
}

export function moduleTypeScriptProjectionObserver<Phase extends string>(
  observer: ((phase: { readonly phase: Phase; readonly durationMs: number; readonly items: number }) => void) | undefined,
) {
  return (phase: Phase, durationMs: number, items: number): void =>
    observeModuleTypeScriptProjection(observer, phase, durationMs, items)
}

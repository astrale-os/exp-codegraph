import type { AnalysisTelemetrySink } from '../../analysis/index.ts'

import { dispatchAnalysisTelemetry } from '../../analysis/profiling/dispatch.ts'

/** Attribute one compiler lifecycle without weakening or relabeling its failure. */
export async function observeCompilerProject<Value>(
  telemetry: AnalysisTelemetrySink | undefined,
  project: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  const started = performance.now()
  emit(telemetry, project, 'started')
  try {
    const result = await operation()
    emit(telemetry, project, 'completed', started)
    return result
  } catch (error) {
    emit(
      telemetry,
      project,
      'failed',
      started,
      error instanceof Error ? error.name : 'unknown',
    )
    throw error
  }
}

function emit(
  telemetry: AnalysisTelemetrySink | undefined,
  project: string,
  status: 'started' | 'completed' | 'failed',
  started?: number,
  error?: string,
): void {
  dispatchAnalysisTelemetry(telemetry, {
    component: 'analysis',
    phase: 'application.compiler-project',
    ...(started === undefined ? {} : { durationNs: Math.round((performance.now() - started) * 1_000_000) }),
    metrics: { status, project, ...(error ? { error } : {}) },
  })
}

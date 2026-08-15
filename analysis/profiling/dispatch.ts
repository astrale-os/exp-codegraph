import {
  ANALYSIS_TELEMETRY_FORMAT,
  type AnalysisTelemetryEvent,
  type AnalysisTelemetrySink,
} from './model.ts'

export function dispatchAnalysisTelemetry(
  sink: AnalysisTelemetrySink | undefined,
  event: Omit<AnalysisTelemetryEvent, 'format' | 'version'>,
): void {
  if (!sink) return
  try {
    sink({ format: ANALYSIS_TELEMETRY_FORMAT, version: 1, ...event })
  } catch {
    // Measurement is deliberately diagnostic-only and cannot change analysis behavior.
  }
}

export const ANALYSIS_TELEMETRY_FORMAT: 'astrale.codegraph.analysis-telemetry'

export type AnalysisTelemetryMetric = string | number | boolean

export interface AnalysisTelemetryEvent {
  readonly format: typeof ANALYSIS_TELEMETRY_FORMAT
  readonly version: 1
  readonly component: 'native' | 'transport' | 'analysis' | 'memory-store' | 'sqlite-store'
  readonly phase: string
  readonly request?: number
  readonly durationNs?: number
  readonly metrics?: Readonly<Record<string, AnalysisTelemetryMetric>>
}

export type AnalysisTelemetrySink = (event: AnalysisTelemetryEvent) => void

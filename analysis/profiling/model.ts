export const ANALYSIS_TELEMETRY_FORMAT = 'astrale.codegraph.analysis-telemetry' as const

export type AnalysisTelemetryMetric = string | number | boolean

/** Diagnostic-only phase attribution. Telemetry never participates in semantic identities. */
export interface AnalysisTelemetryEvent {
  readonly format: typeof ANALYSIS_TELEMETRY_FORMAT
  readonly version: 1
  readonly component: 'native' | 'transport' | 'analysis' | 'memory-store' | 'sqlite-store'
  readonly phase: string
  readonly request?: number
  readonly durationNs?: number
  readonly metrics?: Readonly<Record<string, AnalysisTelemetryMetric>>
}

/** Observers must not influence analysis success, failure, ordering, or identities. */
export type AnalysisTelemetrySink = (event: AnalysisTelemetryEvent) => void

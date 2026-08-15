import type { AnalysisStore } from '../../query/.spec/api.js'
import type { AnalysisTelemetrySink } from '../../profiling/.spec/api.js'

export interface MemoryAnalysisStoreOptions {
  readonly maximumRetainedGenerations?: number
  readonly telemetry?: AnalysisTelemetrySink
}

/** Create an isolated in-memory implementation of the generic AnalysisStore contract. */
export function createMemoryAnalysisStore(options?: MemoryAnalysisStoreOptions): AnalysisStore

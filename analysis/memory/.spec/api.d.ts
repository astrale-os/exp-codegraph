import type { AnalysisStore } from '../../query/.spec/api.js'
import type { AnalysisTelemetrySink } from '../../profiling/.spec/api.js'

export interface MemoryAnalysisStoreOptions {
  readonly maximumRetainedGenerations?: number
  /** Opt-in bound across universes; leased universes and the most recently used universe remain retained. */
  readonly maximumRetainedUniverses?: number
  readonly telemetry?: AnalysisTelemetrySink
}

/** Create an isolated in-memory implementation of the generic AnalysisStore contract. */
export function createMemoryAnalysisStore(options?: MemoryAnalysisStoreOptions): AnalysisStore

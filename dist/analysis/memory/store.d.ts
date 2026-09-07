import type { AnalysisStore } from '../query/index.ts';
import type { AnalysisTelemetrySink } from '../profiling/index.ts';
export interface MemoryAnalysisStoreOptions {
    readonly maximumRetainedGenerations?: number;
    /** Opt-in bound across universes; leased universes and the most recently used universe remain retained. */
    readonly maximumRetainedUniverses?: number;
    readonly telemetry?: AnalysisTelemetrySink;
}
export declare function createMemoryAnalysisStore(options?: MemoryAnalysisStoreOptions): AnalysisStore;

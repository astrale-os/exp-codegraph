import type { AnalysisStore } from '../query/index.ts';
import type { AnalysisTelemetrySink } from '../profiling/index.ts';
export interface MemoryAnalysisStoreOptions {
    readonly maximumRetainedGenerations?: number;
    readonly telemetry?: AnalysisTelemetrySink;
}
export declare function createMemoryAnalysisStore(options?: MemoryAnalysisStoreOptions): AnalysisStore;

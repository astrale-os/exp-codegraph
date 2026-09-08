import type { AnalysisTelemetrySink } from '../../analysis/index.ts';
/** Attribute one compiler lifecycle without weakening or relabeling its failure. */
export declare function observeCompilerProject<Value>(telemetry: AnalysisTelemetrySink | undefined, project: string, operation: () => Promise<Value>): Promise<Value>;

import { type AnalysisTelemetryEvent, type AnalysisTelemetrySink } from './model.ts';
export declare function dispatchAnalysisTelemetry(sink: AnalysisTelemetrySink | undefined, event: Omit<AnalysisTelemetryEvent, 'format' | 'version'>): void;

import type { CliOutput } from './report.ts';
import type { AnalysisTelemetryEvent } from '../analysis/index.ts';
export type ApplicationProgressPhase = 'discover' | 'load' | 'prepare' | 'schemas' | 'packages' | 'contracts' | 'code';
export interface ApplicationProgressEvent {
    readonly phase: ApplicationProgressPhase;
    readonly status: 'started' | 'completed';
    readonly source: string;
    readonly completed?: number;
    readonly total?: number;
}
export interface CliProgress {
    readonly onProgress: (event: ApplicationProgressEvent) => void;
    close(): void;
}
export interface DevStartupProgress {
    /** Return true while startup telemetry has been rendered by this progress view. */
    onTelemetry(event: AnalysisTelemetryEvent): boolean;
    succeed(): void;
    fail(): void;
}
/** Render real startup phases without inventing a percentage or unstable ETA. */
export declare function createDevStartupProgress(output: CliOutput): DevStartupProgress;
/** Render stable, line-oriented progress that remains useful in agent and CI logs. */
export declare function createCliProgress(output: CliOutput, quiet: boolean): CliProgress;

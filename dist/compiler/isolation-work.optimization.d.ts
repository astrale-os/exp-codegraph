export interface ApiCompilerIsolationWork {
    readonly sessions: number;
    readonly programs: number;
    readonly retries: number;
    readonly plannerFallbacks: number;
    readonly workerPeakResidentBytes: number;
    readonly workerResidentUpperBoundBytes: number;
}
/** Count actual worker and Program construction without changing the isolated protocol. */
export declare function recordApiCompilerIsolationWork(delta: Partial<ApiCompilerIsolationWork>): void;
export declare function apiCompilerIsolationWork(): ApiCompilerIsolationWork;
/** Produce one private completion record from Node's cross-platform peak-RSS accounting. */
export declare function apiCompilerWorkerResourceReport(): string;
export declare function parseApiCompilerWorkerResourceReport(input: Uint8Array): number;

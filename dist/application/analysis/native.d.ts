import type { AnalysisTelemetrySink, NativeAnalysisSessionFactory } from '../../analysis/index.ts';
export interface CodegraphApplicationSessionOptions {
    readonly binary?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly maximumFrameBytes?: number;
    readonly transactionChunkFrameBytes?: number;
    readonly maximumTransactionBytes?: number;
    /** Optional native-process resident-set watchdog owned by the Node application adapter. */
    readonly maximumResidentBytes?: number;
    readonly telemetry?: AnalysisTelemetrySink;
}
/** Lazily admit the packaged or explicit native analyzer when a project is first analyzed. */
export declare function createCodegraphApplicationSessionFactory(options?: CodegraphApplicationSessionOptions): NativeAnalysisSessionFactory;

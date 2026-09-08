import type { AnalysisTelemetrySink } from '../profiling/index.ts';
import { type FactPayloadCodec } from '../facts/representation/index.ts';
import type { NativeAnalysisSessionFactory } from './model.ts';
export interface ProcessNativeAnalysisSessionFactoryOptions {
    readonly command: string;
    readonly arguments?: readonly string[];
    readonly environment?: Readonly<Record<string, string>>;
    readonly maximumFrameBytes?: number;
    readonly transactionChunkFrameBytes?: number;
    readonly maximumTransactionBytes?: number;
    /** Maximum encoded physical bytes assembled before semantic decoding. */
    readonly maximumPhysicalTransactionBytes?: number;
    readonly maximumErrorBytes?: number;
    /** Optional application-adapter watchdog for the native process resident set. */
    readonly maximumResidentBytes?: number;
    /** Low-level adapter seam used to qualify resource monitoring without OS-specific test access. */
    readonly sampleResidentBytes?: (pid: number) => Promise<number>;
    /** Opt-in diagnostic attribution, with a marked stderr stream on Windows. */
    readonly telemetry?: AnalysisTelemetrySink;
    /** Explicit physical payload capabilities negotiated with the native producer. */
    readonly payloadCodecs?: readonly FactPayloadCodec[];
}
export declare class NativeAnalysisProcessResourceError extends Error {
    readonly name = "NativeAnalysisProcessResourceError";
    readonly code: 'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED' | 'NATIVE_ANALYSIS_RESIDENT_LIMIT';
    constructor(code: 'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED' | 'NATIVE_ANALYSIS_RESIDENT_LIMIT', message: string, options?: ErrorOptions);
}
export declare const DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS: Readonly<{
    maximumFrameBytes: number;
    transactionChunkFrameBytes: number;
    maximumTransactionBytes: number;
    maximumPhysicalTransactionBytes: number;
    maximumErrorBytes: number;
}>;
export declare function createProcessNativeAnalysisSessionFactory(options: ProcessNativeAnalysisSessionFactoryOptions): NativeAnalysisSessionFactory;

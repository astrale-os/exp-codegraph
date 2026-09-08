import { type MemoryAnalysisStoreOptions } from './memory/index.ts';
import type { AnalysisStore } from './query/index.ts';
export type PersistenceRequirement = 'advisory' | 'required';
export interface AnalysisStoreSelectionOptions {
    readonly persistence: PersistenceRequirement;
    /** Explicit application-owned durable store factory; repositories cannot select executable code. */
    readonly openDurable?: () => Promise<AnalysisStore>;
    readonly memory?: MemoryAnalysisStoreOptions;
}
export interface AnalysisStoreSelection {
    readonly store: AnalysisStore;
    readonly backend: 'durable' | 'memory';
    readonly persistence: PersistenceRequirement;
    readonly fallback?: {
        readonly code: 'DURABLE_STORE_UNAVAILABLE';
        readonly message: string;
        readonly cause: unknown;
    };
}
export declare class AnalysisStoreUnavailableError extends Error {
    readonly name = "AnalysisStoreUnavailableError";
    readonly code = "DURABLE_STORE_UNAVAILABLE";
}
/** Resolve persistence once; required durability fails and advisory durability is explicit. */
export declare function selectAnalysisStore(options: AnalysisStoreSelectionOptions): Promise<AnalysisStoreSelection>;

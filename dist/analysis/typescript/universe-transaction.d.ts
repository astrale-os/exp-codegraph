import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts';
import type { ProjectUniverseId } from '../identity/index.ts';
import type { AnalysisStore } from '../query/index.ts';
import type { NativeFactDelta } from '../protocol/index.ts';
export interface MaterializedNativeTransaction {
    readonly generation: AnalysisGeneration;
    readonly transaction?: FactTransaction;
    readonly rollover: boolean;
}
/**
 * Admit one compiler transaction while preserving universe lineage semantics.
 *
 * A native universe rollover is deliberately emitted as a complete, base-less
 * snapshot. If that portable universe existed before (for example after a
 * tsconfig edit is reverted), this function safely rebases the complete
 * snapshot onto the caller's retained current generation for that universe.
 */
export declare function materializeNativeTransaction(store: AnalysisStore, activeUniverse: ProjectUniverseId | undefined, activeGeneration: AnalysisGeneration | undefined, transaction: FactTransaction, options?: {
    readonly signal?: AbortSignal;
}): Promise<MaterializedNativeTransaction>;
/** Reconstruct and validate one wire-efficient affected-shard delta. */
export declare function materializeNativeDelta(store: AnalysisStore, activeGeneration: AnalysisGeneration | undefined, delta: NativeFactDelta, options?: {
    readonly signal?: AbortSignal;
}): Promise<MaterializedNativeTransaction>;

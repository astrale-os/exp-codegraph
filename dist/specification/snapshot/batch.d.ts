import type { SpecificationSnapshot } from './model.ts';
export interface SpecificationCompilationBatchOptions {
    readonly maximumConcurrency?: number;
    readonly onPhase?: (phase: SpecificationCompilationPhase) => void;
    /** Untrusted candidates whose declaration dependencies must still validate before reuse. */
    readonly previous?: readonly SpecificationSnapshot[];
    readonly changed?: readonly string[];
    /** Include presentation-only declaration source navigation in compiled API models. */
    readonly includeDeclarationNavigation?: boolean;
    /** Include complete normalized declaration models after exact diagnostics pass. */
    readonly includeDeclarationModels?: boolean;
}
export interface SpecificationCompilationPhase {
    readonly phase: 'inventory' | 'declarations' | 'typescript' | 'snapshots';
    readonly durationMs: number;
    readonly items: number;
    readonly programs?: number;
    readonly sessions?: number;
    readonly retries?: number;
    readonly fallbacks?: number;
    readonly workerPeakResidentBytes?: number;
    readonly workerResidentUpperBoundBytes?: number;
    readonly parentPeakResidentBytes?: number;
    /** TypeScript wall time remaining after snapshot work was scheduled. */
    readonly typeScriptTailAfterSnapshotSchedulingMs?: number;
}
/**
 * Compile one coherent corpus through bounded shared declaration and TypeScript waves.
 * The preparation stage is an optimization only; every module still compiles into its
 * independently content-addressed normative snapshot.
 */
export declare function compileSpecificationSnapshots(root: string, directories: readonly string[], options?: SpecificationCompilationBatchOptions): Promise<readonly SpecificationSnapshot[]>;

/// <reference lib="esnext.disposable" preserve="true" />
import type { AnalysisGeneration, FactTransaction } from '../../generation/index.ts';
import type { AnalysisQuery, AnalysisStore } from '../../query/index.ts';
import type { NativeAnalysisSessionFactory, NativeProjectDescriptor, NativeSourceChange } from '../../protocol/index.ts';
import type { SourceId } from '../../identity/index.ts';
import type { TypeScriptFactReader } from '../facts/index.ts';
import type { TypeScriptCallInventory, TypeScriptCallQuery } from '../body/index.ts';
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions } from '../value/index.ts';
export interface TypeScriptProjectOptions {
    readonly root: string;
    readonly config?: string;
    /** Defaults to source, symbol, occurrence and body facts. */
    readonly capabilities?: NativeProjectDescriptor['capabilities'];
    readonly modules?: NativeProjectDescriptor['modules'];
    /** A supplied store remains owned by the caller. */
    readonly store?: AnalysisStore;
    /** Advanced integration: use an application-owned native session provider. */
    readonly sessions?: NativeAnalysisSessionFactory;
    /** Explicit executable for a tool distributing its own qualified native artifact. */
    readonly binary?: string;
}
export interface TypeScriptProjectSnapshot {
    readonly generation: AnalysisGeneration;
    readonly facts: TypeScriptFactReader;
    /** Generic extensions consume the same pinned evidence as the typed reader. */
    readonly query: AnalysisQuery;
    /** Indexed call inventory. Selection precedes site projection, including unresolved calls. */
    calls(options?: TypeScriptCallQuery): Promise<TypeScriptCallInventory>;
    /** Shares one index; evaluator reuse requires the same call model and effective budget. */
    values<Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>): Promise<BoundedValueEvaluator<Atom>>;
    /**
     * Reuses a semantic computation when none of its reads changed. Keep the
     * callback stable and pass every variable external parameter through input.
     * Plain data inputs are captured before yielding; admitted results are owned,
     * deeply frozen plain data. Other inputs/results still execute without reuse.
     * The reader and its evaluators/plans expire when the callback settles.
     */
    compute<Input, Result>(observe: TypeScriptComputation<Input, Result>, input: Input, options?: {
        readonly signal?: AbortSignal;
    }): Promise<Result>;
    dispose(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
/** Tracked semantic reads, with the computation's cancellation and lifetime. */
export interface TypeScriptSemanticReader {
    calls(options?: TypeScriptCallQuery): Promise<TypeScriptCallInventory>;
    values<Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>): Promise<BoundedValueEvaluator<Atom>>;
}
export type TypeScriptComputation<Input, Result> = (read: TypeScriptSemanticReader, input: Input) => Result | Promise<Result>;
/** A resident compiler and its immutable readers, with serialized refresh and recoverable failure. */
export interface TypeScriptProject {
    refresh(options?: TypeScriptProjectRefresh): Promise<TypeScriptProjectUpdate>;
    open(generation?: AnalysisGeneration): Promise<TypeScriptProjectSnapshot>;
    dispose(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
export interface TypeScriptProjectRefresh {
    readonly changed?: readonly string[];
    readonly changes?: readonly NativeSourceChange[];
    readonly invalidate?: boolean;
    readonly signal?: AbortSignal;
}
export interface TypeScriptProjectUpdate {
    readonly generation: AnalysisGeneration;
    /**
     * Exact commits made by this project since its previous successfully returned
     * refresh, in commit order. Empty for a no-op; may contain several commits
     * after recovery. Each transaction keeps its original base and sequence.
     */
    readonly transactions: readonly FactTransaction[];
    /** Source revisions changed by these commits, plus advisory refresh path hints. */
    readonly changedSources: readonly SourceId[];
    readonly diagnostics: readonly string[];
    readonly durationMs: number;
}

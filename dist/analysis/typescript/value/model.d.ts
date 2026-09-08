import type { AnalysisFailure, AnalysisLimit } from '../../facts/index.ts';
import type { FactId } from '../../identity/index.ts';
import type { OccurrenceId, SymbolId } from '../../identity/index.ts';
import type { BodyOccurrence, FunctionBodyIR, ResolvedCall } from '../body/index.ts';
import type { AnalysisQuery } from '../../query/index.ts';
export type ValueResult<Value> = {
    readonly kind: 'known';
    readonly value: Value;
    readonly evidence: readonly FactId[];
} | {
    readonly kind: 'unknown';
    /** Observed possibilities, never an exhaustive set or a known conclusion. */
    readonly candidates?: readonly Value[];
    readonly reasons: readonly AnalysisFailure[];
    readonly evidence: readonly FactId[];
} | {
    readonly kind: 'ambiguous';
    readonly values: readonly Value[];
    readonly reasons: readonly AnalysisLimit[];
    readonly evidence: readonly FactId[];
} | {
    readonly kind: 'unsupported';
    readonly construct: string;
    readonly evidence: readonly FactId[];
};
export interface BoundedValueLimits {
    readonly maximumDepth?: number;
    readonly maximumSteps?: number;
    readonly maximumAlternatives?: number;
}
export type EvaluatedValueResult<Value> = ValueResult<Value> & {
    /** Exact effective budget used for this evaluation, including governed defaults. */
    readonly limits: Readonly<Required<BoundedValueLimits>>;
};
export interface BoundedValueEvaluator<Atom = never> {
    /** Build a lazy symbolic proof, preserving closures and effective object properties. */
    value(occurrence: OccurrenceId): SymbolicValuePlan<Atom>;
    /** Reuse only proofs whose model, budget and positive/negative dependencies still match. */
    canReuse(proof: EvaluatedValueResult<unknown>): boolean;
    /**
     * Resolve literal values and supported transfers in the calling context.
     * Both explicit returns and concise arrow returns retain their expression.
     * Operand relations alone never prove a binary, property, or spread value;
     * unsupported argument bindings and exhausted budgets remain unknown.
     */
    evaluate<Value = unknown>(occurrence: OccurrenceId, options?: {
        readonly signal?: AbortSignal;
    }): Promise<EvaluatedValueResult<Value>>;
}
export interface BoundedValueEvaluatorOptions<Atom = never> {
    readonly call?: SymbolicCallModel<Atom>;
    readonly query: AnalysisQuery;
    readonly limits?: BoundedValueLimits;
}
/** Inspectable shape. Closures, argument environments and object references remain private. */
export type SymbolicValue<Atom = never> = {
    readonly kind: 'literal';
    readonly value: unknown;
} | {
    readonly kind: 'object';
    readonly properties: readonly string[];
    readonly complete: boolean;
} | {
    readonly kind: 'function';
    readonly symbol: SymbolId;
    readonly execution: FunctionBodyIR['execution'];
    readonly parameterCount: number;
} | {
    readonly kind: 'external';
    readonly symbol: SymbolId;
    readonly symbolOrigin?: BodyOccurrence['symbolOrigin'];
} | {
    readonly kind: 'atom';
    readonly value: Atom;
};
export interface SymbolicCallContext<Atom> {
    readonly call: ResolvedCall;
    /** Demand operands only when the model needs them; all reads use the current proof budget. */
    callee(): ValueResult<SymbolicValue<Atom>>;
    receiver(): ValueResult<SymbolicValue<Atom>> | undefined;
    argument(index: number): ValueResult<SymbolicValue<Atom>> | undefined;
}
/** Undefined delegates ordinary TypeScript calls to the generic evaluator. */
export type SymbolicCallModel<Atom> = (context: SymbolicCallContext<Atom>) => {
    readonly kind: 'atom';
    readonly value: Atom;
} | {
    readonly kind: 'unknown';
    readonly reason: string;
} | undefined;
export interface SymbolicValueResolveOptions {
    readonly signal?: AbortSignal;
    readonly limits?: BoundedValueLimits;
}
/** Immutable demand plan: each resolve gets its own budget and evidence. */
export interface SymbolicValuePlan<Atom = never> {
    property(name: string): SymbolicValuePlan<Atom>;
    invoke(): SymbolicValuePlan<Atom>;
    resolve(options?: SymbolicValueResolveOptions): Promise<EvaluatedValueResult<SymbolicValue<Atom>>>;
}

import type { SymbolicCallModel, SymbolicValuePlan } from './symbolic/index.ts'
import type { AnalysisFailure, AnalysisLimit } from '../../facts/index.ts'
import type { FactId } from '../../identity/index.ts'
import type { OccurrenceId } from '../../identity/index.ts'
import type { AnalysisQuery } from '../../query/index.ts'

export type ValueResult<Value> =
  | { readonly kind: 'known'; readonly value: Value; readonly evidence: readonly FactId[] }
  | {
      readonly kind: 'unknown'
      readonly reasons: readonly AnalysisFailure[]
      readonly evidence: readonly FactId[]
    }
  | {
      readonly kind: 'ambiguous'
      readonly values: readonly Value[]
      readonly reasons: readonly AnalysisLimit[]
      readonly evidence: readonly FactId[]
    }
  | {
      readonly kind: 'unsupported'
      readonly construct: string
      readonly evidence: readonly FactId[]
    }

export interface BoundedValueLimits {
  readonly maximumDepth?: number
  readonly maximumSteps?: number
  readonly maximumAlternatives?: number
}

export type EvaluatedValueResult<Value> = ValueResult<Value> & {
  /** Exact effective budget used for this evaluation, including governed defaults. */
  readonly limits: Readonly<Required<BoundedValueLimits>>
}

export interface BoundedValueEvaluator<Atom = never> {
  /** Build a lazy symbolic proof, preserving closures and effective object properties. */
  value(occurrence: OccurrenceId): SymbolicValuePlan<Atom>
  /** Reuse only proofs whose model, budget and positive/negative dependencies still match. */
  canReuse(proof: EvaluatedValueResult<unknown>): boolean
  /**
   * Resolve literal values and supported transfers in the calling context.
   * Both explicit returns and concise arrow returns retain their expression.
   * Operand relations alone never prove a binary, property, or spread value;
   * unsupported argument bindings and exhausted budgets remain unknown.
   */
  evaluate<Value = unknown>(
    occurrence: OccurrenceId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EvaluatedValueResult<Value>>
}

export interface BoundedValueEvaluatorOptions<Atom = never> {
  readonly call?: SymbolicCallModel<Atom>
  readonly query: AnalysisQuery
  readonly limits?: BoundedValueLimits
}

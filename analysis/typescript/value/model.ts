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

export interface BoundedValueEvaluator {
  evaluate<Value = unknown>(
    occurrence: OccurrenceId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EvaluatedValueResult<Value>>
}

export interface BoundedValueEvaluatorOptions {
  readonly query: AnalysisQuery
  readonly limits?: BoundedValueLimits
}

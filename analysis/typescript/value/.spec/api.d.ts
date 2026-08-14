import type { AnalysisLimit, AnalysisFailure } from '../../../facts/.spec/api.js'
import type { FactId } from '../../../identity/.spec/api.js'
import type { OccurrenceId } from '../../../identity/.spec/api.js'
import type { AnalysisQuery } from '../../../query/.spec/api.js'

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

export const DEFAULT_BOUNDED_VALUE_LIMITS: Readonly<Required<BoundedValueLimits>>

export function resolveBoundedValueLimits(
  input?: BoundedValueLimits,
): Readonly<Required<BoundedValueLimits>>

export function createBoundedValueEvaluator(
  options: BoundedValueEvaluatorOptions,
): Promise<BoundedValueEvaluator>

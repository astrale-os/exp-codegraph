import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions } from './model.ts'
import { createValueEvaluatorFactory } from './symbolic/engine.ts'

/** Create an evaluator over one immutable query. Projects share its index across models. */
export function createBoundedValueEvaluator<Atom = never>(
  options: BoundedValueEvaluatorOptions<Atom>,
): Promise<BoundedValueEvaluator<Atom>> {
  return createValueEvaluatorFactory(options.query)(options)
}

import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions } from './model.ts';
/** Create an evaluator over one immutable query. Projects share its index across models. */
export declare function createBoundedValueEvaluator<Atom = never>(options: BoundedValueEvaluatorOptions<Atom>): Promise<BoundedValueEvaluator<Atom>>;

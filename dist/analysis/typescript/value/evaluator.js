import { createValueEvaluatorFactory } from './symbolic/engine.js';
/** Create an evaluator over one immutable query. Projects share its index across models. */
export function createBoundedValueEvaluator(options) {
    return createValueEvaluatorFactory(options.query)(options);
}
//# sourceMappingURL=evaluator.js.map
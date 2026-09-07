import type { AnalysisQuery } from '../../../query/index.ts';
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions } from '../model.ts';
/** Instance-local index owner, shared by every model attached to one pinned snapshot. */
export declare function createValueEvaluatorFactory(query: AnalysisQuery): <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>) => Promise<BoundedValueEvaluator<Atom>>;

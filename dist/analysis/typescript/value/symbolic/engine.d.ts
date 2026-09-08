import type { AnalysisQuery } from '../../../query/index.ts';
import type { TypeScriptCallInventory, TypeScriptCallQuery } from '../../body/index.ts';
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions } from '../model.ts';
/** Instance-local index owner, shared by every model attached to one pinned snapshot. */
interface ValueEvaluatorFactory {
    <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>): Promise<BoundedValueEvaluator<Atom>>;
    calls(options?: TypeScriptCallQuery): Promise<TypeScriptCallInventory>;
}
export declare function createValueEvaluatorFactory(query: AnalysisQuery): ValueEvaluatorFactory;
export {};

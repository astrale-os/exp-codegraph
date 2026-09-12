import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts';
import type { AnalysisQuery } from '../../../query/index.ts';
import type { BodyOccurrence, ResolvedCall, TypeScriptCallInventory, TypeScriptCallQuery } from '../../body/index.ts';
import { type TypeScriptFact } from '../../facts/index.ts';
import type { ValueIndexRevision } from './facts.ts';
import { type CallSelection } from './selection.ts';
interface CallIndex {
    readonly revision?: ValueIndexRevision;
    readonly callsSelection?: CallSelection;
    readonly bodies: ReadonlyMap<SymbolId, TypeScriptFact<'body'>>;
    readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>;
    readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>;
    readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>;
    readonly sources?: ReadonlyMap<SourceId, TypeScriptFact<'source'>>;
    readonly callsBySource?: ReadonlyMap<SourceId, readonly OccurrenceId[]>;
}
export type CallSelectionObserver = (revision: ValueIndexRevision | undefined, keys: readonly string[]) => void;
export declare function createCallProjection(query: AnalysisQuery, loadIndex: () => Promise<CallIndex>): ((options?: TypeScriptCallQuery, observe?: CallSelectionObserver) => Promise<TypeScriptCallInventory>) & {
    dispose(): void;
};
export {};

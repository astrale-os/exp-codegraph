import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts';
import type { AnalysisQuery } from '../../../query/index.ts';
import type { BodyOccurrence, ResolvedCall, TypeScriptCallInventory, TypeScriptCallQuery } from '../../body/index.ts';
import { type TypeScriptFact } from '../../facts/index.ts';
interface CallIndex {
    readonly bodies: ReadonlyMap<SymbolId, TypeScriptFact<'body'>>;
    readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>;
    readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>;
    readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>;
    readonly sources?: ReadonlyMap<SourceId, TypeScriptFact<'source'>>;
    readonly callsBySource?: ReadonlyMap<SourceId, readonly OccurrenceId[]>;
}
export declare function createCallProjection(query: AnalysisQuery, loadIndex: () => Promise<CallIndex>): ((options?: TypeScriptCallQuery) => Promise<TypeScriptCallInventory>) & {
    dispose(): void;
};
export {};

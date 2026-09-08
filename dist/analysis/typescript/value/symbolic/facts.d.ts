import type { FactId, OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts';
import type { AnalysisQuery } from '../../../query/index.ts';
import type { BodyOccurrence, ResolvedCall } from '../../body/index.ts';
import { type TypeScriptFact } from '../../facts/index.ts';
import type { ValueResult } from '../model.ts';
type Body = TypeScriptFact<'body'>;
export type IndexedFact = Body | TypeScriptFact<'symbol'> | TypeScriptFact<'source'>;
export interface ValueDependency {
    readonly key: string;
    readonly fingerprint: string | undefined;
}
export interface ValueIndexRevision {
    readonly token: object;
    readonly parent?: object;
    readonly changed: ReadonlySet<string>;
}
export interface ValueIndex {
    readonly bodies: ReadonlyMap<SymbolId, Body>;
    readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>;
    readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>;
    readonly parents: ReadonlyMap<OccurrenceId, readonly {
        parent: OccurrenceId;
        role: string;
    }[]>;
    readonly definitions: ReadonlyMap<OccurrenceId, readonly OccurrenceId[]>;
    readonly definiteDefinitions: ReadonlySet<OccurrenceId>;
    readonly initializers: ReadonlyMap<SymbolId, readonly OccurrenceId[]>;
    readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>;
    readonly direct: ReadonlyMap<OccurrenceId, ValueResult<unknown>>;
    readonly symbols: ReadonlyMap<SymbolId, TypeScriptFact<'symbol'>>;
    readonly sources: ReadonlyMap<SourceId, TypeScriptFact<'source'>>;
    readonly callsBySource: ReadonlyMap<SourceId, readonly OccurrenceId[]>;
    readonly mutations: ReadonlyMap<SymbolId, readonly SymbolId[]>;
    readonly escapes: ReadonlySet<SymbolId>;
    readonly aliases: ReadonlyMap<SymbolId, readonly SymbolId[]>;
    readonly fingerprints: Pick<ReadonlyMap<string, string>, 'get'>;
    readonly evidence: Pick<ReadonlyMap<string, readonly FactId[]>, 'get'>;
    readonly revision: ValueIndexRevision;
    dependency(key: string): ValueDependency;
}
export declare class IndexedValues implements ValueIndex {
    #private;
    readonly work: {
        readonly facts: number;
        readonly bodies: number;
        readonly contributions: number;
    };
    readonly bodies: ValueIndex['bodies'];
    readonly occurrences: ValueIndex['occurrences'];
    readonly children: ValueIndex['children'];
    readonly parents: ValueIndex['parents'];
    readonly definitions: ValueIndex['definitions'];
    readonly definiteDefinitions: ValueIndex['definiteDefinitions'];
    readonly initializers: ValueIndex['initializers'];
    readonly calls: ValueIndex['calls'];
    readonly direct: ValueIndex['direct'];
    readonly symbols: ValueIndex['symbols'];
    readonly sources: ValueIndex['sources'];
    readonly callsBySource: ValueIndex['callsBySource'];
    readonly mutations: ValueIndex['mutations'];
    readonly escapes: ValueIndex['escapes'];
    readonly aliases: ValueIndex['aliases'];
    readonly fingerprints: ValueIndex['fingerprints'];
    readonly evidence: ValueIndex['evidence'];
    readonly revision: ValueIndexRevision;
    private constructor();
    static empty(): IndexedValues;
    dependency(key: string): ValueDependency;
    private fingerprint;
    update(upserts: readonly IndexedFact[], deletes: readonly FactId[], initial?: boolean): IndexedValues;
}
export declare function loadValueIndex(query: AnalysisQuery): Promise<IndexedValues>;
export declare function readIndexedBodies(query: AnalysisQuery, ids?: readonly FactId[]): Promise<readonly TypeScriptFact<'body'>[]>;
export {};

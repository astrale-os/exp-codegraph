import type { AnalysisFailure, AnalysisLimit, Completeness } from '../../facts/index.ts';
import type { FactId, OccurrenceId, SourceId, SourceRevisionId, SymbolId } from '../../identity/index.ts';
import type { FunctionBodyIR } from '../body/model.ts';
import type { ValueResult } from '../value/model.ts';
export interface PackedBodyData {
    readonly c: readonly unknown[];
    readonly s: readonly unknown[];
    readonly t: readonly unknown[];
    readonly p: readonly unknown[];
    readonly o: readonly unknown[];
    readonly r: readonly unknown[];
    readonly b: readonly unknown[];
    readonly e: readonly unknown[];
    readonly d: readonly unknown[];
    readonly a: readonly unknown[];
    readonly u: readonly unknown[];
    readonly v: readonly unknown[];
    readonly q: unknown;
}
/** One private cell; every assigned property is owned even when an option is absent. */
export declare function createOccurrenceScratch(source: SourceId, revision: SourceRevisionId, owner: SymbolId): {
    id: OccurrenceId;
    kind: FunctionBodyIR['occurrences'][number]['kind'];
    span: {
        source: SourceId;
        revision: SourceRevisionId;
        start: number;
        end: number;
    };
    owner: SymbolId;
    syntax: string;
    symbol: SymbolId | undefined;
    symbolOrigin: FunctionBodyIR['occurrences'][number]['symbolOrigin'];
    operator: string | undefined;
    symbolKind: FunctionBodyIR['occurrences'][number]['symbolKind'];
    propertyName: string | undefined;
    propertyNamespace: SymbolId | undefined;
};
export type OccurrenceScratch = ReturnType<typeof createOccurrenceScratch>;
type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
};
type OccurrenceLookup = (value: unknown, path: string) => OccurrenceId;
type TextLookup = (value: unknown, path: string) => string;
export declare function decodeRelation(value: unknown, index: number, occurrence: OccurrenceLookup, text: TextLookup, result?: Mutable<FunctionBodyIR['relations'][number]>): FunctionBodyIR['relations'][number];
export declare function decodeBlock(value: unknown, index: number, occurrence: OccurrenceLookup, text: TextLookup): FunctionBodyIR['blocks'][number];
export type EdgeScratch = Mutable<Omit<FunctionBodyIR['edges'][number], 'evidence'>> & {
    evidence: OccurrenceId | undefined;
};
export type DefinitionScratch = Mutable<Omit<FunctionBodyIR['definitions'][number], 'symbol'>> & {
    symbol: SymbolId | undefined;
};
export declare function decodeEdge(value: unknown, index: number, occurrenceCount: number, occurrenceIds: readonly OccurrenceId[], block: TextLookup, text: TextLookup, result?: EdgeScratch): FunctionBodyIR['edges'][number];
export declare function decodeDefinition(value: unknown, index: number, symbols: readonly SymbolId[], occurrence: OccurrenceLookup, text: TextLookup, result?: DefinitionScratch): FunctionBodyIR['definitions'][number];
export declare function decodeSummary(value: unknown, owner: SymbolId, occurrences: readonly OccurrenceId[], symbol: (value: unknown, path: string) => SymbolId): FunctionBodyIR['summary'];
export declare function decodeOccurrence(value: unknown, index: number, version: number, source: SourceId, revision: SourceRevisionId, owner: SymbolId, symbols: readonly SymbolId[], texts: readonly string[], scratch?: OccurrenceScratch): FunctionBodyIR['occurrences'][number];
export declare function decodeCall(value: unknown, index: number, version: number, symbols: readonly SymbolId[], texts: readonly string[], occurrenceCount: number, occurrence: (value: unknown, path: string) => OccurrenceId): FunctionBodyIR['calls'][number];
export declare function admitSymbolOrigin(input: unknown): NonNullable<FunctionBodyIR['occurrences'][number]['symbolOrigin']>;
export declare function admitCompleteness(value: unknown, path: string): Completeness;
export declare function admitValueResult(value: unknown, path: string): ValueResult<unknown>;
export declare function admitLimit(value: unknown, path: string): AnalysisLimit;
export declare function ownedValue(value: unknown): unknown;
export declare function admitFailure(value: unknown, path: string): AnalysisFailure;
export declare function factIdentities(value: unknown, path: string): readonly FactId[];
export declare function analysisIdentity(value: unknown, kind: string): boolean;
export declare function record(value: unknown, path: string): Record<string, unknown>;
export declare function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void;
export declare function occurrenceArray(value: unknown, occurrences: readonly OccurrenceId[], path: string): readonly OccurrenceId[];
export declare function expandId(value: unknown, kind: string): string;
export declare function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown>;
export declare function exactTuple(value: unknown, length: number, path: string): readonly unknown[];
export declare function array(value: unknown, path: string): readonly unknown[];
export declare function uniqueStrings(values: readonly unknown[], path: string): readonly string[];
export declare function unique(values: readonly string[], path: string): void;
export declare function ordinal(value: unknown, length: number, path: string): number;
export declare function optionalOrdinal(value: unknown, length: number, path: string): number | undefined;
export declare function integer(value: unknown, minimum: number, path: string): number;
export declare function bit(value: unknown, path: string): boolean;
export {};

import { type AnalysisFailure, type AnalysisLimit, type Completeness } from '../../../facts/index.ts';
import type { SourceId } from '../../../identity/index.ts';
import type { CapabilityStatus } from '../../../query/index.ts';
import type { TypeScriptCallQuery } from '../../body/index.ts';
import type { TypeScriptFact } from '../../facts/index.ts';
import { ValueIndexTable } from './table.ts';
type Body = TypeScriptFact<'body'>;
type Reason = AnalysisFailure | AnalysisLimit;
interface CountedReason {
    readonly reason: Reason;
    readonly count: number;
}
interface SourceLookup {
    readonly sources: ReadonlyMap<SourceId, TypeScriptFact<'source'>>;
    readonly callsBySource: ReadonlyMap<SourceId, readonly unknown[]>;
}
export declare const CALL_SELECTION: 'typescript.calls/v1';
export declare const callSelectionKey: {
    global: string;
    all: string;
    unmapped: string;
    source: (source: SourceId) => string;
    path: (path: string) => string;
};
export declare function callSelectionKeys(options: TypeScriptCallQuery): readonly string[];
export declare function inventoryCompleteness(completeness: Completeness): Completeness;
export declare function reasonKey(reason: AnalysisLimit): string;
export declare function unavailable(message: string): Completeness;
export declare function freezeCompleteness(value: Completeness): Completeness;
/** Retain partial contributions even while unavailable reasons mask them. */
declare class CompletionCounts {
    #private;
    readonly partial: ValueIndexTable<string, CountedReason>;
    readonly unavailable: ValueIndexTable<string, CountedReason>;
    constructor(partial?: ValueIndexTable<string, CountedReason>, unavailable?: ValueIndexTable<string, CountedReason>);
    get empty(): boolean;
    adjust(value: Completeness, direction: 1 | -1): CompletionCounts;
    value(): Completeness;
}
/** Persistent selection metadata, published with the same revision as its value columns. */
export declare class CallSelection {
    #private;
    readonly completion: Completeness;
    readonly unmapped: number;
    constructor(attributed?: ValueIndexTable<string, number>, bySource?: ValueIndexTable<SourceId, CompletionCounts>, unattributed?: CompletionCounts, completion?: Completeness, unmapped?: number);
    local(source: SourceId): Completeness | undefined;
    sources(): IterableIterator<readonly [SourceId, Completeness]>;
    update(bodies: Iterable<readonly [Body | undefined, Body | undefined]>, touched: Set<SourceId>, before: SourceLookup, after: SourceLookup, capabilities: readonly CapabilityStatus[] | undefined, changed?: Set<string>): CallSelection;
}
export {};

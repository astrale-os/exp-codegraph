import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts';
import type { BodyOccurrence, ResolvedCall } from '../../body/index.ts';
import type { TypeScriptFact } from '../../facts/index.ts';
import { type PackedTypeScriptBodyProjection } from '../../physical/index.ts';
import type { ValueResult } from '../model.ts';
export interface NodeReference {
    readonly fragment: BodyFragment;
    readonly row: number;
}
export declare class BodyFragment {
    #private;
    readonly fact: TypeScriptFact<'body'>;
    readonly owner: SymbolId;
    readonly source: SourceId | undefined;
    readonly effects: readonly number[];
    readonly callsBySource: ReadonlyMap<SourceId, readonly OccurrenceId[]>;
    readonly packed: PackedTypeScriptBodyProjection | undefined;
    constructor(fact: TypeScriptFact<'body'>);
    logicalNodes(): readonly NodeReference[];
    logicalCalls(): readonly NodeReference[];
    id(row: number): OccurrenceId;
    effectNode(row: number): Pick<BodyOccurrence, 'id' | 'kind' | 'syntax' | 'symbol' | 'owner'>;
    effectCall(row: number): Pick<ResolvedCall, 'occurrence' | 'target' | 'dynamic' | 'arguments' | 'bindings'>;
    node(row: number): BodyOccurrence;
    callId(row: number): OccurrenceId;
    call(row: number): ResolvedCall;
    children(row: number): ReadonlyMap<string, OccurrenceId> | undefined;
    parents(row: number): readonly {
        parent: OccurrenceId;
        role: string;
    }[] | undefined;
    definitions(row: number): readonly OccurrenceId[] | undefined;
    definite(row: number): boolean;
    value(row: number): ValueResult<unknown> | undefined;
}
export declare function bodyFragment(fact: TypeScriptFact<'body'>): BodyFragment;

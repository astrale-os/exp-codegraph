import type { Fact } from '../../facts/index.ts';
import { type FactPayloadCodec, type PhysicalPayloadRecord } from '../../facts/representation/index.ts';
import type { OccurrenceId, SourceId, SourceRevisionId, SymbolId } from '../../identity/index.ts';
import type { ValueResult } from '../value/model.ts';
import { type FunctionBodyIR } from '../body/model.ts';
export declare const TYPESCRIPT_BODY_PAYLOAD_CODEC_ID = "typescript.body.packed/6";
export declare const TYPESCRIPT_BODY_PAYLOAD_CODEC: FactPayloadCodec;
export declare const TYPESCRIPT_FACT_PAYLOAD_CODECS: readonly FactPayloadCodec[];
/** Private column view; creation requires the exact admitted, owned physical state. */
export declare class PackedTypeScriptBodyProjection {
    #private;
    readonly record: PhysicalPayloadRecord;
    readonly owner: SymbolId;
    readonly source: SourceId;
    readonly revision: SourceRevisionId;
    readonly occurrences: readonly OccurrenceId[];
    readonly calls: readonly number[];
    readonly effectCandidates: readonly number[];
    constructor(record: PhysicalPayloadRecord, version: number);
    effectNode(index: number): Pick<FunctionBodyIR['occurrences'][number], 'id' | 'kind' | 'syntax' | 'symbol' | 'owner'>;
    effectCall(index: number): Pick<FunctionBodyIR['calls'][number], 'occurrence' | 'target' | 'dynamic' | 'arguments' | 'bindings'>;
    occurrence(index: number): FunctionBodyIR['occurrences'][number];
    call(index: number): FunctionBodyIR['calls'][number];
    children(index: number): ReadonlyMap<string, OccurrenceId> | undefined;
    parents(index: number): readonly {
        parent: OccurrenceId;
        role: string;
    }[] | undefined;
    definitions(index: number): readonly OccurrenceId[] | undefined;
    definite(index: number): boolean;
    value(index: number): ValueResult<unknown> | undefined;
    private relations;
    private definitionRows;
}
export declare function projectPackedTypeScriptBody(fact: Fact): PackedTypeScriptBodyProjection | undefined;

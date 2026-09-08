import type { Fact } from '../types.ts';
import type { AnalysisGenerationId } from '../../identity/index.ts';
export interface PhysicalPayloadRecord {
    readonly codec: string;
    readonly data: unknown;
}
/**
 * One explicitly composed decoder for a private storage/wire representation.
 * Semantic Fact consumers never observe the encoded representation.
 */
export interface FactPayloadCodec {
    readonly id: string;
    decode(data: unknown): unknown;
}
export type StoredFactPayload = {
    readonly kind: 'semantic';
    readonly value: unknown;
} | {
    readonly kind: 'physical';
    readonly codec: string;
    readonly data: unknown;
};
export type FactPayloadCodecMap = ReadonlyMap<string, FactPayloadCodec>;
export declare function admitFactPayloadCodecs(codecs: readonly FactPayloadCodec[] | undefined): FactPayloadCodecMap;
export declare function createFactWithSemanticPayload(fields: Omit<Fact, 'payload'>, payload: unknown): Fact;
export declare function createFactWithPhysicalPayload(fields: Omit<Fact, 'payload'>, input: unknown, codecs: FactPayloadCodecMap, owner: string): Fact;
export declare function createFactWithStoredPayload(fields: Omit<Fact, 'payload'>, payload: StoredFactPayload, codecs: FactPayloadCodecMap, owner: string): Fact;
/** Private transport representation, kept out-of-band from semantic payload values. */
export declare function physicalPayloadForTransport(fact: Fact): PhysicalPayloadRecord | undefined;
/** Private persistence representation with an unambiguous outer discriminant. */
export declare function payloadForStorage(fact: Fact): readonly unknown[];
/** Decode for semantic identity/admission without retaining the expanded value. */
export declare function payloadForSemanticIdentity(fact: Fact): unknown;
export declare function admitStoredFactPayload(value: unknown, owner: string): StoredFactPayload;
export declare function bindPhysicalFact(fact: Fact, generation: AnalysisGenerationId): Fact;
/** Freeze a fact without invoking a lazily decoded semantic payload. */
export declare function immutableFact(fact: Fact): Fact;
export declare function admittedFactShardPayloadBytes(shard: object): number | undefined;
export declare function certifyFactShard(shard: object, semanticPayloadBytes: number): void;

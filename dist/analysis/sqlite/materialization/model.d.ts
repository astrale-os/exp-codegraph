import type { Completeness, Fact, FactHeader, FactShard } from '../../facts/index.ts';
import type { AnalysisGeneration } from '../../generation/index.ts';
import type { AnalysisGenerationId } from '../../identity/index.ts';
import { type FactPayloadCodecMap, type StoredFactPayload } from '../../facts/representation/index.ts';
export interface GenerationRow {
    readonly universe: string;
    readonly sequence: number;
    readonly generation_id: string;
    readonly producer_id: string;
    readonly producer_name: string;
    readonly producer_version: string;
    readonly protocol_version: number;
    readonly source_manifest: string;
    readonly capabilities_json: string;
}
export interface ShardRow {
    readonly shard_digest: string;
    readonly shard_key: string;
    readonly fact_namespace: string;
    readonly schema_version: number;
    readonly completion_kind: Completeness['kind'];
    readonly completion_json: string;
    readonly capabilities_json: string;
    readonly fact_count: number;
    readonly payload_layout: string;
}
export interface FactRow {
    readonly shard_digest: string;
    readonly fact_id: string;
    readonly fact_namespace: string;
    readonly schema_version: number;
    readonly kind: string;
    readonly subject: string;
    readonly completeness_kind: Completeness['kind'];
    readonly completeness_json: string;
    readonly pass_id: string;
    readonly pass_version: string;
    readonly payload_json: string;
}
export type FactHeaderRow = Omit<FactRow, 'payload_json'>;
export interface EvidenceRow {
    readonly shard_digest: string;
    readonly fact_id: string;
    readonly ordinal: number;
    readonly source_id: string;
    readonly source_revision: string;
    readonly start_offset: number;
    readonly end_offset: number;
}
export interface InputRow {
    readonly shard_digest: string;
    readonly fact_id: string;
    readonly ordinal: number;
    readonly input_fact_id: string;
}
export declare function generationFromRow(row: GenerationRow): AnalysisGeneration;
export declare function shardFromRows(row: ShardRow, facts: readonly Fact[]): FactShard;
export declare function factFromRows(row: FactRow, generation: AnalysisGenerationId, evidence: readonly EvidenceRow[], inputs: readonly InputRow[], payload: StoredFactPayload, payloadCodecs: FactPayloadCodecMap): Fact;
export declare function factHeaderFromRows(row: FactHeaderRow, generation: AnalysisGenerationId, evidence: readonly EvidenceRow[], inputs: readonly InputRow[]): FactHeader;
export declare function encodeJson(value: unknown): string;
export declare function parseJson(value: string, owner: string): unknown;
export declare function parseCapabilities(value: string, owner: string): readonly string[];

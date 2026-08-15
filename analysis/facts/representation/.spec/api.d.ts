import type { Fact } from '../../.spec/api.js'
import type { AnalysisGenerationId } from '../../../identity/.spec/api.js'

export interface PhysicalPayloadRecord {
  readonly codec: string
  readonly data: unknown
}

/** Decode one negotiated private payload representation into the semantic Fact payload. */
export interface FactPayloadCodec {
  readonly id: string
  decode(data: unknown): unknown
}

export type StoredFactPayload =
  | { readonly kind: 'semantic'; readonly value: unknown }
  | { readonly kind: 'physical'; readonly codec: string; readonly data: unknown }

export type FactPayloadCodecMap = ReadonlyMap<string, FactPayloadCodec>

export function admitFactPayloadCodecs(
  codecs: readonly FactPayloadCodec[] | undefined,
): FactPayloadCodecMap
export function createFactWithSemanticPayload(
  fields: Omit<Fact, 'payload'>,
  payload: unknown,
): Fact
export function createFactWithPhysicalPayload(
  fields: Omit<Fact, 'payload'>,
  input: unknown,
  codecs: FactPayloadCodecMap,
  owner: string,
): Fact
export function createFactWithStoredPayload(
  fields: Omit<Fact, 'payload'>,
  payload: StoredFactPayload,
  codecs: FactPayloadCodecMap,
  owner: string,
): Fact
export function physicalPayloadForTransport(fact: Fact): PhysicalPayloadRecord | undefined
export function payloadForStorage(fact: Fact): readonly unknown[]
export function payloadForSemanticIdentity(fact: Fact): unknown
export function admitStoredFactPayload(value: unknown, owner: string): StoredFactPayload
export function bindPhysicalFact(fact: Fact, generation: AnalysisGenerationId): Fact
export function immutableFact(fact: Fact): Fact
export function admittedFactShardPayloadBytes(shard: object): number | undefined
export function certifyFactShard(shard: object, semanticPayloadBytes: number): void

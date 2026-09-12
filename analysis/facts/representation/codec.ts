import type { Fact, FactShard } from '../types.ts'
import type { AnalysisGenerationId } from '../../identity/index.ts'

const PHYSICAL_STATES = new WeakMap<object, PhysicalPayloadState>()
const ADMITTED_SHARDS = new WeakMap<object, number>()
const OWNED_PAYLOAD_CODECS = new WeakSet<FactPayloadCodec>()
const IMMUTABLE_PAYLOADS = new WeakSet<object>()
const OWNED_PHYSICAL_RECORDS = new WeakSet<object>()
const OWNED_WIRE_SHARDS = new WeakSet<object>()
const OWNED_PAYLOAD_IDENTITIES = new WeakMap<FactPayloadCodec, (data: unknown) => OwnedPayloadIdentity>()

export interface PhysicalPayloadRecord {
  readonly codec: string
  readonly data: unknown
}

/**
 * One explicitly composed decoder for a private storage/wire representation.
 * Semantic Fact consumers never observe the encoded representation.
 */
export interface FactPayloadCodec {
  readonly id: string
  decode(data: unknown): unknown
}

/** Internal composition only: this decoder constructs an owned plain data tree. */
export function ownFactPayloadCodec<Codec extends FactPayloadCodec>(codec: Codec): Codec {
  OWNED_PAYLOAD_CODECS.add(codec)
  return Object.freeze(codec)
}

/** Private codec composition: validate first, then emit the logical JSON identity. */
export interface OwnedPayloadIdentity {
  write(writer: OwnedPayloadIdentityWriter): void
}

export interface OwnedPayloadIdentityWriter {
  /** Fixed ASCII JSON punctuation and field names, never unescaped input. */
  part(value: string): void
  /** A logical JSON value; escaping, key order and byte counting belong to the writer. */
  value(value: unknown): void
}

export function ownFactPayloadIdentity<Codec extends FactPayloadCodec>(
  codec: Codec,
  prepare: (data: unknown) => OwnedPayloadIdentity,
): Codec {
  OWNED_PAYLOAD_IDENTITIES.set(codec, prepare)
  return ownFactPayloadCodec(codec)
}

/** No preparation runs until the complete shard qualifies for this private path. */
export function prepareOwnedFactShardIdentity(shard: FactShard): readonly OwnedPayloadIdentity[] | undefined {
  if (!OWNED_WIRE_SHARDS.has(shard) || !shard.facts.length) return
  const inputs: { readonly data: unknown; readonly prepare: (data: unknown) => OwnedPayloadIdentity }[] = []
  for (const fact of shard.facts) {
    const state = physicalState(fact)
    if (!state?.owned || state.status !== undefined || !OWNED_PAYLOAD_CODECS.has(state.codec)) return
    const prepare = OWNED_PAYLOAD_IDENTITIES.get(state.codec)
    if (!prepare) return
    inputs.push({ data: state.record.data, prepare })
  }
  // Preserve the decoder's fact order, including failure before any identity work.
  return inputs.map(({ data, prepare }) => prepare(data))
}

/** Certificates concern decoded roots, never a codec name or a caller's frozen object. */
export function hasImmutableFactPayload(payload: object): boolean {
  return IMMUTABLE_PAYLOADS.has(payload)
}

export type StoredFactPayload =
  | { readonly kind: 'semantic'; readonly value: unknown }
  | { readonly kind: 'physical'; readonly codec: string; readonly data: unknown }

interface PhysicalPayloadState {
  readonly record: PhysicalPayloadRecord
  readonly codec: FactPayloadCodec
  readonly owned: boolean
  admitted?: true
  decoded?: unknown
  failure?: unknown
  status?: 'decoded' | 'failed'
}

export type FactPayloadCodecMap = ReadonlyMap<string, FactPayloadCodec>

export function admitFactPayloadCodecs(
  codecs: readonly FactPayloadCodec[] | undefined,
): FactPayloadCodecMap {
  const admitted = new Map<string, FactPayloadCodec>()
  for (const codec of codecs ?? []) {
    if (!/^[a-z0-9][a-z0-9._/-]*$/u.test(codec.id)) {
      throw new TypeError(`Fact payload codec identity ${codec.id} is invalid.`)
    }
    if (typeof codec.decode !== 'function') {
      throw new TypeError(`Fact payload codec ${codec.id} has no decoder.`)
    }
    if (admitted.has(codec.id)) {
      throw new TypeError(`Fact payload codec ${codec.id} is duplicated.`)
    }
    admitted.set(codec.id, codec)
  }
  return admitted
}

export function createFactWithSemanticPayload(
  fields: Omit<Fact, 'payload'>,
  payload: unknown,
): Fact {
  return { ...fields, payload }
}

export function createFactWithPhysicalPayload(
  fields: Omit<Fact, 'payload'>,
  input: unknown,
  codecs: FactPayloadCodecMap,
  owner: string,
): Fact {
  const record = admitPhysicalPayloadRecord(input, owner)
  const codec = codecs.get(record.codec)
  if (!codec) throw new TypeError(`${owner} uses unsupported fact payload codec ${record.codec}.`)
  const owned = input !== null && typeof input === 'object' && OWNED_PHYSICAL_RECORDS.has(input)
  return createPhysicalFact(fields, {
    record: owned ? freezeOwnedJSON(record) : deepFreeze(record),
    codec,
    owned,
  })
}

/** Internal JSON ingress only: the caller owns this freshly parsed plain tree. */
export function ownPhysicalPayloadRecord<Value>(record: Value): Value {
  if (record !== null && typeof record === 'object') OWNED_PHYSICAL_RECORDS.add(record)
  return record
}

/** Internal wire ingress owns this freshly reconstructed envelope and JSON tree. */
export function ownWireFactShard<Shard extends FactShard>(shard: Shard): Shard {
  OWNED_WIRE_SHARDS.add(shard)
  return shard
}

/** Ownership is not admission: the complete semantic digest must still be checked. */
export function canStreamFactShardIdentity(shard: FactShard): boolean {
  if (!OWNED_WIRE_SHARDS.has(shard)) return false
  return shard.facts.every((fact) => {
    const state = physicalState(fact)
    // Semantic wire payloads are freshly parsed JSON. A physical payload also
    // needs the exact composed decoder's promise of an owned plain data tree.
    return !state || state.owned && OWNED_PAYLOAD_CODECS.has(state.codec)
  })
}

/** An admitted immutable representation belongs to this exact decoder instance. */
export function physicalPayloadForProjection(fact: Fact, codec: FactPayloadCodec): PhysicalPayloadRecord | undefined {
  const state = physicalState(fact)
  return state?.owned && state.admitted && state.codec === codec && OWNED_PAYLOAD_CODECS.has(codec)
    ? state.record : undefined
}

export function createFactWithStoredPayload(
  fields: Omit<Fact, 'payload'>,
  payload: StoredFactPayload,
  codecs: FactPayloadCodecMap,
  owner: string,
): Fact {
  return payload.kind === 'semantic'
    ? createFactWithSemanticPayload(fields, payload.value)
    : createFactWithPhysicalPayload(
        fields,
        { codec: payload.codec, data: payload.data },
        codecs,
        owner,
      )
}

/** Private transport representation, kept out-of-band from semantic payload values. */
export function physicalPayloadForTransport(fact: Fact): PhysicalPayloadRecord | undefined {
  return physicalState(fact)?.record
}

/** Private persistence representation with an unambiguous outer discriminant. */
export function payloadForStorage(fact: Fact): readonly unknown[] {
  const state = physicalState(fact)
  return state
    ? ['physical', state.record.codec, state.record.data]
    : ['semantic', fact.payload]
}

/** Decode for semantic identity/admission without retaining the expanded value. */
export function payloadForSemanticIdentity(fact: Fact): unknown {
  const state = physicalState(fact)
  if (!state) return fact.payload
  if (state.status === 'decoded') return state.decoded
  if (state.status === 'failed') throw state.failure
  return state.codec.decode(state.record.data)
}

export function admitStoredFactPayload(value: unknown, owner: string): StoredFactPayload {
  if (!Array.isArray(value)) throw new TypeError(`${owner} has an invalid stored payload record.`)
  if (value.length === 2 && value[0] === 'semantic') {
    return { kind: 'semantic', value: value[1] }
  }
  if (value.length === 3 && value[0] === 'physical' && typeof value[1] === 'string') {
    return { kind: 'physical', codec: value[1], data: value[2] }
  }
  throw new TypeError(`${owner} has an invalid stored payload record.`)
}

export function bindPhysicalFact(
  fact: Fact,
  generation: AnalysisGenerationId,
): Fact {
  if (fact.generation === generation) return fact
  const state = physicalState(fact)
  const fields: Omit<Fact, 'payload'> = {
    id: fact.id,
    generation,
    namespace: fact.namespace,
    schemaVersion: fact.schemaVersion,
    kind: fact.kind,
    subject: fact.subject,
    completeness: fact.completeness,
    provenance: fact.provenance,
  }
  return state
    ? createPhysicalFact(fields, state)
    : createFactWithSemanticPayload(fields, fact.payload)
}

/** Freeze a fact without invoking a lazily decoded semantic payload. */
export function immutableFact(fact: Fact): Fact {
  const state = physicalState(fact)
  if (!state) return deepFreeze(fact)
  deepFreeze(fact.completeness)
  deepFreeze(fact.provenance)
  return Object.freeze(fact)
}

export function admittedFactShardPayloadBytes(shard: object): number | undefined {
  return ADMITTED_SHARDS.get(shard)
}

export function certifyFactShard(shard: { readonly facts: readonly Fact[] }, semanticPayloadBytes: number): void {
  freezeWithoutInvokingGetters(shard)
  ADMITTED_SHARDS.set(shard, semanticPayloadBytes)
  for (const fact of shard.facts) {
    const state = physicalState(fact)
    if (state?.owned) state.admitted = true
  }
}

function createPhysicalFact(
  fields: Omit<Fact, 'payload'>,
  state: PhysicalPayloadState,
): Fact {
  const fact = { ...fields } as Fact
  PHYSICAL_STATES.set(fact, state)
  Object.defineProperty(fact, 'payload', {
    enumerable: true,
    get: () => decodedPayload(state),
  })
  return fact
}

function decodedPayload(state: PhysicalPayloadState): unknown {
  if (state.status === 'decoded') return state.decoded
  if (state.status === 'failed') throw state.failure
  try {
    const owned = OWNED_PAYLOAD_CODECS.has(state.codec)
    state.decoded = deepFreeze(state.codec.decode(state.record.data), owned)
    if (owned && state.decoded !== null && typeof state.decoded === 'object') {
      IMMUTABLE_PAYLOADS.add(state.decoded)
    }
    state.status = 'decoded'
    return state.decoded
  } catch (error) {
    state.failure = error
    state.status = 'failed'
    throw error
  }
}

function physicalState(fact: Fact): PhysicalPayloadState | undefined {
  return PHYSICAL_STATES.get(fact)
}

function admitPhysicalPayloadRecord(value: unknown, owner: string): PhysicalPayloadRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${owner} has an invalid physical payload record.`)
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.codec !== 'string' ||
    !record.codec ||
    !Object.hasOwn(record, 'data') ||
    Object.keys(record).some((key) => key !== 'codec' && key !== 'data')
  ) {
    throw new TypeError(`${owner} has an invalid physical payload record.`)
  }
  return { codec: record.codec, data: record.data }
}

function deepFreeze<Value>(value: Value, owned = false): Value {
  // Owned decoder trees are traversed once, including any already frozen parents.
  // Object.isFrozen alone cannot certify their descendants.
  if (!value || typeof value !== 'object' || (!owned && Object.isFrozen(value))) return value
  if (value instanceof Map) {
    for (const entry of value.values()) deepFreeze(entry, owned)
  } else {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) deepFreeze(descriptor.value, owned)
    }
  }
  return Object.freeze(value)
}

/** JSON ingress owns plain data, so large packed arrays need no property descriptors. */
function freezeOwnedJSON<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  // A frozen parent does not certify its children. Traverse every owned input
  // once, including roots or nested containers frozen before admission.
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) freezeOwnedJSON(value[index])
  } else {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) freezeOwnedJSON(record[key])
  }
  return Object.freeze(value)
}

function freezeWithoutInvokingGetters<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) freezeWithoutInvokingGetters(descriptor.value)
  }
  return Object.freeze(value)
}

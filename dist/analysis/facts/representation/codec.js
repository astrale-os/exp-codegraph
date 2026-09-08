const PHYSICAL_STATES = new WeakMap();
const ADMITTED_SHARDS = new WeakMap();
const OWNED_PAYLOAD_CODECS = new WeakSet();
const IMMUTABLE_PAYLOADS = new WeakSet();
const OWNED_PHYSICAL_RECORDS = new WeakSet();
/** Internal composition only: this decoder constructs an owned plain data tree. */
export function ownFactPayloadCodec(codec) {
    OWNED_PAYLOAD_CODECS.add(codec);
    return Object.freeze(codec);
}
/** Certificates concern decoded roots, never a codec name or a caller's frozen object. */
export function hasImmutableFactPayload(payload) {
    return IMMUTABLE_PAYLOADS.has(payload);
}
export function admitFactPayloadCodecs(codecs) {
    const admitted = new Map();
    for (const codec of codecs ?? []) {
        if (!/^[a-z0-9][a-z0-9._/-]*$/u.test(codec.id)) {
            throw new TypeError(`Fact payload codec identity ${codec.id} is invalid.`);
        }
        if (typeof codec.decode !== 'function') {
            throw new TypeError(`Fact payload codec ${codec.id} has no decoder.`);
        }
        if (admitted.has(codec.id)) {
            throw new TypeError(`Fact payload codec ${codec.id} is duplicated.`);
        }
        admitted.set(codec.id, codec);
    }
    return admitted;
}
export function createFactWithSemanticPayload(fields, payload) {
    return { ...fields, payload };
}
export function createFactWithPhysicalPayload(fields, input, codecs, owner) {
    const record = admitPhysicalPayloadRecord(input, owner);
    const codec = codecs.get(record.codec);
    if (!codec)
        throw new TypeError(`${owner} uses unsupported fact payload codec ${record.codec}.`);
    return createPhysicalFact(fields, {
        record: deepFreeze(record),
        codec,
        owned: input !== null && typeof input === 'object' && OWNED_PHYSICAL_RECORDS.has(input),
    });
}
/** Internal JSON ingress only: the caller owns this freshly parsed plain tree. */
export function ownPhysicalPayloadRecord(record) {
    if (record !== null && typeof record === 'object')
        OWNED_PHYSICAL_RECORDS.add(record);
    return record;
}
/** An admitted immutable representation belongs to this exact decoder instance. */
export function physicalPayloadForProjection(fact, codec) {
    const state = physicalState(fact);
    return state?.owned && state.admitted && state.codec === codec && OWNED_PAYLOAD_CODECS.has(codec)
        ? state.record : undefined;
}
export function createFactWithStoredPayload(fields, payload, codecs, owner) {
    return payload.kind === 'semantic'
        ? createFactWithSemanticPayload(fields, payload.value)
        : createFactWithPhysicalPayload(fields, { codec: payload.codec, data: payload.data }, codecs, owner);
}
/** Private transport representation, kept out-of-band from semantic payload values. */
export function physicalPayloadForTransport(fact) {
    return physicalState(fact)?.record;
}
/** Private persistence representation with an unambiguous outer discriminant. */
export function payloadForStorage(fact) {
    const state = physicalState(fact);
    return state
        ? ['physical', state.record.codec, state.record.data]
        : ['semantic', fact.payload];
}
/** Decode for semantic identity/admission without retaining the expanded value. */
export function payloadForSemanticIdentity(fact) {
    const state = physicalState(fact);
    if (!state)
        return fact.payload;
    if (state.status === 'decoded')
        return state.decoded;
    if (state.status === 'failed')
        throw state.failure;
    return state.codec.decode(state.record.data);
}
export function admitStoredFactPayload(value, owner) {
    if (!Array.isArray(value))
        throw new TypeError(`${owner} has an invalid stored payload record.`);
    if (value.length === 2 && value[0] === 'semantic') {
        return { kind: 'semantic', value: value[1] };
    }
    if (value.length === 3 && value[0] === 'physical' && typeof value[1] === 'string') {
        return { kind: 'physical', codec: value[1], data: value[2] };
    }
    throw new TypeError(`${owner} has an invalid stored payload record.`);
}
export function bindPhysicalFact(fact, generation) {
    if (fact.generation === generation)
        return fact;
    const state = physicalState(fact);
    const fields = {
        id: fact.id,
        generation,
        namespace: fact.namespace,
        schemaVersion: fact.schemaVersion,
        kind: fact.kind,
        subject: fact.subject,
        completeness: fact.completeness,
        provenance: fact.provenance,
    };
    return state
        ? createPhysicalFact(fields, state)
        : createFactWithSemanticPayload(fields, fact.payload);
}
/** Freeze a fact without invoking a lazily decoded semantic payload. */
export function immutableFact(fact) {
    const state = physicalState(fact);
    if (!state)
        return deepFreeze(fact);
    deepFreeze(fact.completeness);
    deepFreeze(fact.provenance);
    return Object.freeze(fact);
}
export function admittedFactShardPayloadBytes(shard) {
    return ADMITTED_SHARDS.get(shard);
}
export function certifyFactShard(shard, semanticPayloadBytes) {
    freezeWithoutInvokingGetters(shard);
    ADMITTED_SHARDS.set(shard, semanticPayloadBytes);
    for (const fact of shard.facts) {
        const state = physicalState(fact);
        if (state?.owned)
            state.admitted = true;
    }
}
function createPhysicalFact(fields, state) {
    const fact = { ...fields };
    PHYSICAL_STATES.set(fact, state);
    Object.defineProperty(fact, 'payload', {
        enumerable: true,
        get: () => decodedPayload(state),
    });
    return fact;
}
function decodedPayload(state) {
    if (state.status === 'decoded')
        return state.decoded;
    if (state.status === 'failed')
        throw state.failure;
    try {
        const owned = OWNED_PAYLOAD_CODECS.has(state.codec);
        state.decoded = deepFreeze(state.codec.decode(state.record.data), owned);
        if (owned && state.decoded !== null && typeof state.decoded === 'object') {
            IMMUTABLE_PAYLOADS.add(state.decoded);
        }
        state.status = 'decoded';
        return state.decoded;
    }
    catch (error) {
        state.failure = error;
        state.status = 'failed';
        throw error;
    }
}
function physicalState(fact) {
    return PHYSICAL_STATES.get(fact);
}
function admitPhysicalPayloadRecord(value, owner) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${owner} has an invalid physical payload record.`);
    }
    const record = value;
    if (typeof record.codec !== 'string' ||
        !record.codec ||
        !Object.hasOwn(record, 'data') ||
        Object.keys(record).some((key) => key !== 'codec' && key !== 'data')) {
        throw new TypeError(`${owner} has an invalid physical payload record.`);
    }
    return { codec: record.codec, data: record.data };
}
function deepFreeze(value, owned = false) {
    // Owned decoder trees are traversed once, including any already frozen parents.
    // Object.isFrozen alone cannot certify their descendants.
    if (!value || typeof value !== 'object' || (!owned && Object.isFrozen(value)))
        return value;
    if (value instanceof Map) {
        for (const entry of value.values())
            deepFreeze(entry, owned);
    }
    else {
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if ('value' in descriptor)
                deepFreeze(descriptor.value, owned);
        }
    }
    return Object.freeze(value);
}
function freezeWithoutInvokingGetters(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor)
            freezeWithoutInvokingGetters(descriptor.value);
    }
    return Object.freeze(value);
}
//# sourceMappingURL=codec.js.map
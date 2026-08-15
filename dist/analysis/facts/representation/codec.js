const PHYSICAL_PAYLOAD = Symbol('codegraph.physical-fact-payload');
const ADMITTED_SHARDS = new WeakMap();
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
    });
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
}
function createPhysicalFact(fields, state) {
    const fact = { ...fields };
    Object.defineProperty(fact, PHYSICAL_PAYLOAD, { value: state });
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
        state.decoded = deepFreeze(state.codec.decode(state.record.data));
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
    return fact[PHYSICAL_PAYLOAD];
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
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    if (value instanceof Map) {
        for (const entry of value.values())
            deepFreeze(entry);
    }
    else {
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if ('value' in descriptor)
                deepFreeze(descriptor.value);
        }
    }
    return Object.freeze(value);
}
function freezeWithoutInvokingGetters(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const key of Reflect.ownKeys(value)) {
        // The private decode state is intentionally mutable after the public Fact
        // and its semantic fields become immutable. It memoizes one result/error
        // without becoming part of the Fact's observable value or identity.
        if (key === PHYSICAL_PAYLOAD)
            continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor)
            freezeWithoutInvokingGetters(descriptor.value);
    }
    return Object.freeze(value);
}
//# sourceMappingURL=codec.js.map
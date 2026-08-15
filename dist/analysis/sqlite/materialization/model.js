import { stableJson } from '../../identity/model.js';
import { createFactWithStoredPayload, immutableFact, } from '../../facts/representation/index.js';
export function generationFromRow(row) {
    const capabilities = parseJson(row.capabilities_json, 'generation capabilities');
    if (!Array.isArray(capabilities) || capabilities.some((entry) => typeof entry !== 'string')) {
        throw new TypeError('Persisted analysis generation capabilities are invalid.');
    }
    return immutable({
        id: row.generation_id,
        sequence: row.sequence,
        universe: row.universe,
        producer: {
            id: row.producer_id,
            name: row.producer_name,
            version: row.producer_version,
            protocolVersion: row.protocol_version,
        },
        sourceManifest: row.source_manifest,
        capabilities,
    });
}
export function shardFromRows(row, facts) {
    const completion = parseCompleteness(row.completion_json, row.completion_kind, 'shard');
    const capabilities = parseCapabilities(row.capabilities_json, 'shard capabilities');
    return immutable({
        key: row.shard_key,
        digest: row.shard_digest,
        namespace: row.fact_namespace,
        schemaVersion: row.schema_version,
        completion,
        facts,
        ...(capabilities.length ? { capabilities } : {}),
    });
}
export function factFromRows(row, generation, evidence, inputs, payload, payloadCodecs) {
    return immutableFact(createFactWithStoredPayload({
        id: row.fact_id,
        generation,
        namespace: row.fact_namespace,
        schemaVersion: row.schema_version,
        kind: row.kind,
        subject: row.subject,
        completeness: parseCompleteness(row.completeness_json, row.completeness_kind, `fact ${row.fact_id}`),
        provenance: provenanceFromRows(row, evidence, inputs),
    }, payload, payloadCodecs, `fact ${row.fact_id} payload`));
}
export function factHeaderFromRows(row, generation, evidence, inputs) {
    return immutable({
        id: row.fact_id,
        generation,
        namespace: row.fact_namespace,
        schemaVersion: row.schema_version,
        kind: row.kind,
        subject: row.subject,
        completeness: parseCompleteness(row.completeness_json, row.completeness_kind, `fact ${row.fact_id}`),
        provenance: provenanceFromRows(row, evidence, inputs),
    });
}
function provenanceFromRows(row, evidence, inputs) {
    return {
        pass: row.pass_id,
        passVersion: row.pass_version,
        evidence: [...evidence]
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((entry) => ({
            source: entry.source_id,
            revision: entry.source_revision,
            start: entry.start_offset,
            end: entry.end_offset,
        })),
        inputs: [...inputs]
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((entry) => entry.input_fact_id),
    };
}
export function encodeJson(value) {
    return stableJson(value);
}
export function parseJson(value, owner) {
    try {
        return JSON.parse(value);
    }
    catch (error) {
        throw new TypeError(`Persisted ${owner} JSON is invalid.`, { cause: error });
    }
}
export function parseCapabilities(value, owner) {
    const parsed = parseJson(value, owner);
    if (!Array.isArray(parsed) ||
        parsed.some((entry) => typeof entry !== 'string' || !entry.trim()) ||
        [...new Set(parsed)].sort().some((entry, index) => entry !== parsed[index]))
        throw new TypeError(`Persisted ${owner} are invalid.`);
    return parsed;
}
function parseCompleteness(value, indexedKind, owner) {
    const parsed = parseJson(value, `${owner} completeness`);
    if (!parsed ||
        typeof parsed !== 'object' ||
        !['complete', 'partial', 'unavailable'].includes(parsed.kind) ||
        parsed.kind !== indexedKind) {
        throw new TypeError(`Persisted ${owner} completeness is invalid.`);
    }
    if (parsed.kind !== 'complete' && !Array.isArray(parsed.reasons)) {
        throw new TypeError(`Persisted ${owner} completeness reasons are invalid.`);
    }
    return parsed;
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const entry of Object.values(value))
        immutable(entry);
    return Object.freeze(value);
}
//# sourceMappingURL=model.js.map
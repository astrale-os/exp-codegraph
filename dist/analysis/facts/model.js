import { deriveAnalysisId } from '../identity/index.js';
import { admittedFactShardPayloadBytes, certifyFactShard, payloadForSemanticIdentity, } from './representation/index.js';
const textEncoder = new TextEncoder();
/** Read a fact envelope without invoking a lazy semantic payload getter. */
export function factHeader(fact) {
    return {
        id: fact.id,
        generation: fact.generation,
        namespace: fact.namespace,
        schemaVersion: fact.schemaVersion,
        kind: fact.kind,
        subject: fact.subject,
        completeness: fact.completeness,
        provenance: fact.provenance,
    };
}
export function factShardDigest(shard) {
    const { digest: _digest, ...semantic } = shard;
    return deriveAnalysisId('fact-shard-digest', shard.namespace, {
        ...semantic,
        facts: shard.facts.map(semanticFactIdentity),
    });
}
export function validateFactShard(shard) {
    if (admittedFactShardPayloadBytes(shard) !== undefined)
        return [];
    const diagnostics = [];
    if (!shard.namespace.trim())
        diagnostics.push('FACT_NAMESPACE_REQUIRED');
    if (!Number.isSafeInteger(shard.schemaVersion) || shard.schemaVersion < 1) {
        diagnostics.push('FACT_SCHEMA_VERSION_INVALID');
    }
    if (shard.capabilities &&
        (shard.capabilities.some((capability) => !capability.trim()) ||
            [...new Set(shard.capabilities)].sort().some((capability, index) => capability !== shard.capabilities?.[index])))
        diagnostics.push('FACT_SHARD_CAPABILITIES_INVALID');
    validateCompleteness(shard.completion, diagnostics, 'SHARD');
    const identities = new Set();
    let previous = '';
    for (const fact of shard.facts) {
        if (identities.has(fact.id))
            diagnostics.push(`FACT_ID_DUPLICATE:${fact.id}`);
        identities.add(fact.id);
        if (previous && fact.id.localeCompare(previous) <= 0)
            diagnostics.push('FACT_ORDER_INVALID');
        previous = fact.id;
        if (fact.namespace !== shard.namespace)
            diagnostics.push(`FACT_NAMESPACE_MISMATCH:${fact.id}`);
        if (fact.schemaVersion !== shard.schemaVersion)
            diagnostics.push(`FACT_SCHEMA_MISMATCH:${fact.id}`);
        if (!fact.kind || !fact.subject)
            diagnostics.push(`FACT_SHAPE_INVALID:${fact.id}`);
        validateCompleteness(fact.completeness, diagnostics, `FACT:${fact.id}`);
        if (!fact.provenance.passVersion)
            diagnostics.push(`FACT_PRODUCER_VERSION_REQUIRED:${fact.id}`);
        for (const evidence of fact.provenance.evidence) {
            if (!Number.isSafeInteger(evidence.start) ||
                !Number.isSafeInteger(evidence.end) ||
                evidence.start < 0 ||
                evidence.end <= evidence.start) {
                diagnostics.push(`FACT_EVIDENCE_RANGE_INVALID:${fact.id}`);
            }
        }
    }
    const semanticFacts = shard.facts.map(semanticFactIdentity);
    const expected = deriveAnalysisId('fact-shard-digest', shard.namespace, {
        key: shard.key,
        namespace: shard.namespace,
        schemaVersion: shard.schemaVersion,
        completion: shard.completion,
        facts: semanticFacts,
        ...(shard.capabilities ? { capabilities: shard.capabilities } : {}),
    });
    if (shard.digest !== expected) {
        diagnostics.push(`FACT_SHARD_DIGEST_MISMATCH:expected=${expected}:actual=${shard.digest}:subjects=${[
            ...new Set(shard.facts.map((fact) => fact.subject)),
        ].join(',')}`);
    }
    const result = [...new Set(diagnostics)].sort();
    if (!result.length) {
        // A valid shard is an immutable semantic certificate. Later transaction
        // admission may safely reuse it without decoding private payloads again.
        certifyFactShard(shard, semanticFacts.reduce((bytes, fact) => bytes + encodedPayloadBytes(fact.payload), 0));
    }
    return result;
}
export function shardReference(shard) {
    return {
        key: shard.key,
        digest: shard.digest,
        namespace: shard.namespace,
        schemaVersion: shard.schemaVersion,
        facts: shard.facts.length,
        ...(shard.capabilities ? { capabilities: shard.capabilities } : {}),
    };
}
function validateCompleteness(value, diagnostics, owner) {
    if (value.kind === 'complete')
        return;
    if (!value.reasons.length)
        diagnostics.push(`${owner}_COMPLETENESS_REASONS_REQUIRED`);
    for (const reason of value.reasons) {
        if (!reason.code || !reason.message)
            diagnostics.push(`${owner}_COMPLETENESS_REASON_INVALID`);
    }
}
function semanticFactIdentity(fact) {
    return {
        id: fact.id,
        namespace: fact.namespace,
        schemaVersion: fact.schemaVersion,
        kind: fact.kind,
        subject: fact.subject,
        completeness: fact.completeness,
        provenance: fact.provenance,
        payload: payloadForSemanticIdentity(fact),
    };
}
function encodedPayloadBytes(payload) {
    const encoded = JSON.stringify(payload);
    if (encoded === undefined)
        throw new TypeError('Fact payload is not JSON-serializable.');
    return textEncoder.encode(encoded).byteLength;
}
//# sourceMappingURL=model.js.map
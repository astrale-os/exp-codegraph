import { createHash } from 'node:crypto';
import { decodeWorkspaceCheckpointJson, encodeWorkspaceCheckpointJson, WORKSPACE_CHECKPOINT_JSON_ENCODING, } from '../../workspace/checkpoint/index.js';
import { createApplicationSnapshot } from '../snapshot/index.js';
import { TYPE_SPEC_APPLICATION_LIMITS } from '../limits.js';
import { packSpecificationSnapshot, unpackSpecificationSnapshot, } from './representation.js';
const FORMAT = 'astrale.codegraph.application-checkpoint';
const VERSION = 2;
const MAXIMUM_DECODED_ARTIFACT_BYTES = TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes;
const MAXIMUM_DECODED_CHECKPOINT_BYTES = TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointBytes;
const SCOPE_PREFIX = 'application-';
const CORPUS = 'corpus/index.json.br';
const STATISTICS = 'corpus/statistics.json.br';
const INVENTORY = 'corpus/inventory.json.br';
const QUALIFICATIONS = 'snapshot/qualifications-index.json.br';
const SNAPSHOT = 'snapshot/core.json.br';
const API_PAYLOADS = 'corpus/api-payloads-index.json.br';
const PACKED_REPRESENTATION = 'packed-api-payloads/1';
/** Bind application identities and schemas to the generic content-addressed checkpoint store. */
export function createApplicationCheckpoint(options) {
    if (!options.producerFingerprint.trim()) {
        throw new TypeError('Application checkpoint producerFingerprint must be non-empty.');
    }
    let persisted;
    const checkpoint = {
        async load(expectation) {
            let loaded;
            try {
                loaded = await options.store.load(checkpointScope(expectation), signalOptions(expectation));
            }
            catch {
                return miss('unavailable');
            }
            if (!loaded.ok) {
                return miss(loaded.reason === 'manifest-missing'
                    ? 'missing'
                    : loaded.reason.includes('corrupt')
                        ? 'corrupt'
                        : 'unavailable');
            }
            try {
                const payload = record(loaded.manifest.payload);
                if (loaded.manifest.format !== FORMAT ||
                    loaded.manifest.version !== VERSION ||
                    loaded.manifest.producerFingerprint !== options.producerFingerprint ||
                    payload.repository !== expectation.repository ||
                    payload.inventory !== expectation.inventory ||
                    payload.request !== expectation.request) {
                    return miss('incompatible');
                }
                if (payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
                    !Number.isSafeInteger(payload.decodedBytes) ||
                    payload.decodedBytes < 0 ||
                    payload.decodedBytes > MAXIMUM_DECODED_CHECKPOINT_BYTES)
                    return miss('incompatible');
                const representation = payload.representation;
                if (representation !== undefined && representation !== PACKED_REPRESENTATION) {
                    return miss('incompatible');
                }
                const decoded = { bytes: 0, artifacts: new Map() };
                const apiPayloads = new Map();
                let apiPayloadIndex = [];
                if (representation === PACKED_REPRESENTATION) {
                    apiPayloadIndex = artifactIndex(loaded.artifacts, API_PAYLOADS, decoded);
                    for (const { source: key, key: artifact } of apiPayloadIndex) {
                        const value = jsonArtifact(loaded.artifacts, artifact, decoded);
                        if (apiPayloads.has(key))
                            throw new Error(`Checkpoint API payload is duplicated: ${key}`);
                        apiPayloads.set(key, value);
                    }
                }
                const corpusIndex = artifactIndex(loaded.artifacts, CORPUS, decoded);
                const specificationDescriptors = new Map();
                const specifications = corpusIndex.map(({ source, key }) => {
                    const stored = jsonArtifact(loaded.artifacts, key, decoded);
                    const packed = stored;
                    const specification = representation === PACKED_REPRESENTATION
                        ? unpackSpecificationSnapshot(packed, apiPayloads)
                        : stored;
                    if (specification.source !== source)
                        throw new Error('Checkpoint specification index drifted.');
                    if (specificationDescriptors.has(source)) {
                        throw new Error(`Checkpoint specification source is duplicated: ${source}`);
                    }
                    specificationDescriptors.set(source, {
                        key,
                        identity: specification.id,
                        ...(representation === PACKED_REPRESENTATION
                            ? { payloads: packedSpecificationPayloadKeys(packed) }
                            : {}),
                    });
                    return specification;
                });
                const statistics = jsonArtifact(loaded.artifacts, STATISTICS, decoded);
                const inventory = jsonArtifact(loaded.artifacts, INVENTORY, decoded);
                const qualificationIndex = artifactIndex(loaded.artifacts, QUALIFICATIONS, decoded);
                const qualificationDescriptors = new Map();
                const qualifications = qualificationIndex.map(({ source, key }) => {
                    const qualification = jsonArtifact(loaded.artifacts, key, decoded);
                    if (qualification.specification.source !== source) {
                        throw new Error('Checkpoint qualification index drifted.');
                    }
                    if (qualificationDescriptors.has(source)) {
                        throw new Error(`Checkpoint qualification source is duplicated: ${source}`);
                    }
                    qualificationDescriptors.set(source, { key, identity: qualification.id });
                    return qualification;
                });
                const core = record(jsonArtifact(loaded.artifacts, SNAPSHOT, decoded));
                if (decoded.bytes !== payload.decodedBytes)
                    return miss('corrupt');
                if (statistics.repository !== expectation.repository ||
                    statistics.inventory !== expectation.inventory ||
                    inventory.repository !== expectation.repository ||
                    inventory.revision !== expectation.inventory ||
                    !Array.isArray(inventory.files) ||
                    !Array.isArray(statistics.files))
                    return miss('incompatible');
                const bySource = new Map(specifications.map((value) => [value.source, value]));
                const analysis = core.analysis === undefined
                    ? undefined
                    : core.analysis;
                for (const qualification of qualifications) {
                    const specification = bySource.get(qualification.specification.source);
                    if (!specification ||
                        qualification.specification.id !== specification.id ||
                        qualification.specification.revision !== specification.revision) {
                        throw new Error('Checkpoint qualification does not match its specification snapshot.');
                    }
                    if (!analysis ||
                        qualification.analysis.id !== analysis.id ||
                        !sameStrings(qualification.analysis.universes, analysis.universes)) {
                        throw new Error('Checkpoint qualification does not match its analysis snapshot.');
                    }
                }
                const included = stringArray(core.specifications).map((source) => {
                    const specification = bySource.get(source);
                    if (!specification)
                        throw new Error(`Checkpoint specification is missing: ${source}`);
                    return specification;
                });
                const includedSources = new Set(included.map((value) => value.source));
                if (includedSources.size !== included.length) {
                    throw new Error('Checkpoint selected specification sources are duplicated.');
                }
                if (qualifications.some((value) => !includedSources.has(value.specification.source))) {
                    throw new Error('Checkpoint qualification is outside the selected specification corpus.');
                }
                const candidate = createApplicationSnapshot({
                    repository: expectation.repository,
                    inventory: expectation.inventory,
                    selection: core.selection,
                    specifications: included,
                    statistics,
                    qualifications,
                    ...(analysis === undefined ? {} : { analysis }),
                    diagnostics: array(core.diagnostics),
                    analysisDiagnostics: stringArray(core.analysisDiagnostics),
                });
                if (candidate.id !== payload.snapshot)
                    return miss('incompatible');
                persisted = {
                    specifications: specificationDescriptors,
                    apiPayloads: new Map(apiPayloadIndex.map(({ source, key }) => [source, { key, identity: source }])),
                    qualifications: qualificationDescriptors,
                    artifacts: loaded.artifacts,
                    decodedBytes: decoded.artifacts,
                };
                const content = { snapshot: candidate, specifications, inventory, statistics };
                if (representation === undefined) {
                    await checkpoint.publish(expectation, content).catch(() => undefined);
                }
                return {
                    ok: true,
                    content,
                };
            }
            catch {
                return miss('corrupt');
            }
        },
        async publish(expectation, content) {
            const snapshot = content.snapshot;
            if (snapshot.repository !== expectation.repository ||
                snapshot.inventory !== expectation.inventory ||
                content.statistics.repository !== expectation.repository ||
                content.statistics.inventory !== expectation.inventory ||
                content.inventory.repository !== expectation.repository ||
                content.inventory.revision !== expectation.inventory) {
                throw new Error('Application checkpoint content does not match its exact expectation.');
            }
            const apiPayloads = new Map();
            const specificationIndex = [...content.specifications]
                .sort((left, right) => left.source.localeCompare(right.source))
                .map((specification) => {
                const retained = persisted?.specifications.get(specification.source);
                if (retained?.identity === specification.id && retained.payloads) {
                    return {
                        source: specification.source,
                        key: retained.key,
                        identity: specification.id,
                        payloads: retained.payloads,
                    };
                }
                const value = packSpecificationSnapshot(specification, apiPayloads);
                return {
                    source: specification.source,
                    key: artifactKey('specification', specification.source),
                    identity: specification.id,
                    payloads: packedSpecificationPayloadKeys(value),
                    value,
                };
            });
            const requiredApiPayloads = new Set(specificationIndex.flatMap((value) => value.payloads));
            const apiPayloadIndex = [...requiredApiPayloads]
                .sort((left, right) => left.localeCompare(right))
                .map((source) => ({
                source,
                key: persisted?.apiPayloads.get(source)?.key ?? artifactKey('api-payload', source),
                identity: source,
                ...(apiPayloads.has(source) ? { value: apiPayloads.get(source) } : {}),
            }));
            const qualificationIndex = [...snapshot.qualifications]
                .sort((left, right) => left.specification.source.localeCompare(right.specification.source))
                .map((qualification) => {
                const source = qualification.specification.source;
                const retained = persisted?.qualifications.get(source);
                return {
                    source,
                    key: retained?.identity === qualification.id
                        ? retained.key
                        : artifactKey('qualification', source),
                    identity: qualification.id,
                    ...(retained?.identity === qualification.id ? {} : { value: qualification }),
                };
            });
            const artifacts = new Map();
            const artifactDecodedBytes = new Map();
            let decodedBytes = 0;
            const add = (key, value) => {
                const encoded = encodeWorkspaceCheckpointJson(value, {
                    maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
                });
                decodedBytes += encoded.decodedBytes;
                if (decodedBytes > MAXIMUM_DECODED_CHECKPOINT_BYTES) {
                    throw new RangeError('Application checkpoint exceeds its decoded byte budget.');
                }
                artifacts.set(key, encoded.value);
                artifactDecodedBytes.set(key, encoded.decodedBytes);
            };
            const retain = (key) => {
                const bytes = persisted?.artifacts.get(key);
                const size = persisted?.decodedBytes.get(key);
                if (!bytes || size === undefined)
                    return false;
                decodedBytes += size;
                if (decodedBytes > MAXIMUM_DECODED_CHECKPOINT_BYTES) {
                    throw new RangeError('Application checkpoint exceeds its decoded byte budget.');
                }
                artifacts.set(key, bytes);
                artifactDecodedBytes.set(key, size);
                return true;
            };
            add(CORPUS, specificationIndex.map(({ source, key, identity, payloads }) => ({
                source,
                key,
                identity,
                payloads,
            })));
            add(API_PAYLOADS, apiPayloadIndex.map(({ source, key, identity }) => ({ source, key, identity })));
            add(STATISTICS, content.statistics);
            add(INVENTORY, content.inventory);
            add(QUALIFICATIONS, qualificationIndex.map(({ source, key, identity }) => ({
                source,
                key,
                identity,
            })));
            add(SNAPSHOT, {
                selection: snapshot.selection,
                specifications: snapshot.specifications.map((value) => value.source),
                ...(snapshot.analysis === undefined ? {} : { analysis: snapshot.analysis }),
                diagnostics: snapshot.diagnostics,
                analysisDiagnostics: snapshot.analysisDiagnostics,
            });
            for (const descriptor of specificationIndex) {
                if ('value' in descriptor)
                    add(descriptor.key, descriptor.value);
                else if (!retain(descriptor.key))
                    throw new Error(`Retained specification artifact is missing: ${descriptor.source}`);
            }
            for (const descriptor of apiPayloadIndex) {
                if ('value' in descriptor)
                    add(descriptor.key, descriptor.value);
                else if (!retain(descriptor.key))
                    throw new Error(`Retained API payload artifact is missing: ${descriptor.source}`);
            }
            for (const descriptor of qualificationIndex) {
                if ('value' in descriptor)
                    add(descriptor.key, descriptor.value);
                else if (!retain(descriptor.key))
                    throw new Error(`Retained qualification artifact is missing: ${descriptor.source}`);
            }
            await options.store.publish(checkpointScope(expectation), {
                manifest: {
                    format: FORMAT,
                    version: VERSION,
                    producerFingerprint: options.producerFingerprint,
                    payload: {
                        repository: expectation.repository,
                        inventory: expectation.inventory,
                        request: expectation.request,
                        snapshot: snapshot.id,
                        encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
                        representation: PACKED_REPRESENTATION,
                        decodedBytes,
                    },
                },
                artifacts,
            }, signalOptions(expectation));
            persisted = {
                specifications: new Map(specificationIndex.map(({ source, key, identity, payloads }) => [
                    source,
                    { key, identity, payloads },
                ])),
                apiPayloads: new Map(apiPayloadIndex.map(({ source, key, identity }) => [source, { key, identity }])),
                qualifications: new Map(qualificationIndex.map(({ source, key, identity }) => [source, { key, identity }])),
                artifacts,
                decodedBytes: artifactDecodedBytes,
            };
        },
    };
    return checkpoint;
}
function checkpointScope(expectation) {
    return `${SCOPE_PREFIX}${createHash('sha256').update(expectation.request).digest('hex').slice(0, 32)}`;
}
function signalOptions(expectation) {
    return expectation.signal ? { signal: expectation.signal } : {};
}
function jsonArtifact(artifacts, key, decoded) {
    const bytes = artifacts.get(key);
    if (!bytes)
        throw new Error(`Checkpoint artifact is missing: ${key}`);
    const artifact = decodeWorkspaceCheckpointJson(bytes, {
        maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
    });
    decoded.bytes += artifact.decodedBytes;
    decoded.artifacts?.set(key, artifact.decodedBytes);
    if (decoded.bytes > MAXIMUM_DECODED_CHECKPOINT_BYTES) {
        throw new RangeError('Application checkpoint exceeds its decoded byte budget.');
    }
    return artifact.value;
}
function packedSpecificationPayloadKeys(specification) {
    const module = specification.module;
    return [...new Set([
            ...(module.api?.model?.sourceKeys ?? []),
            ...(module.internal?.model?.sourceKeys ?? []),
            ...module.ports.flatMap((port) => port.model?.sourceKeys ?? []),
        ])].sort();
}
function artifactIndex(artifacts, key, decoded) {
    const value = jsonArtifact(artifacts, key, decoded);
    if (!Array.isArray(value) ||
        !value.every((entry) => recordOrUndefined(entry) !== undefined &&
            typeof recordOrUndefined(entry)?.source === 'string' &&
            typeof recordOrUndefined(entry)?.key === 'string'))
        throw new TypeError('Checkpoint artifact index is invalid.');
    return value;
}
function artifactKey(kind, source) {
    return `${kind}/${createHash('sha256').update(source).digest('hex')}.json.br`;
}
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Checkpoint value is not an object.');
    }
    return value;
}
function recordOrUndefined(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function array(value) {
    if (!Array.isArray(value))
        throw new TypeError('Checkpoint value is not an array.');
    return value;
}
function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function stringArray(value) {
    const values = array(value);
    if (!values.every((entry) => typeof entry === 'string')) {
        throw new TypeError('Checkpoint value is not a string array.');
    }
    return values;
}
function miss(reason) {
    return { ok: false, reason };
}
/** Compile-time assertion that the manifest payload stays inside the generic JSON boundary. */
const _jsonBoundary = { format: FORMAT, version: VERSION };
void _jsonBoundary;
/** Restore exact generation identities without exposing physical database identifiers. */
export function checkpointGenerations(snapshot) {
    return new Map((snapshot.analysis?.generations ?? []).map(({ universe, generation }) => [universe, generation]));
}
//# sourceMappingURL=checkpoint.js.map
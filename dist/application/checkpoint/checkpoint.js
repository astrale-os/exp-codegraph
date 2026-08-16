import { createHash } from 'node:crypto';
import { createApplicationSnapshot } from '../snapshot/index.js';
const FORMAT = 'astrale.codegraph.application-checkpoint';
const VERSION = 1;
const SCOPE_PREFIX = 'application-';
const CORPUS = 'corpus/index.json';
const STATISTICS = 'corpus/statistics.json';
const INVENTORY = 'corpus/inventory.json';
const QUALIFICATIONS = 'snapshot/qualifications-index.json';
const SNAPSHOT = 'snapshot/core.json';
/** Bind application identities and schemas to the generic content-addressed checkpoint store. */
export function createApplicationCheckpoint(options) {
    if (!options.producerFingerprint.trim()) {
        throw new TypeError('Application checkpoint producerFingerprint must be non-empty.');
    }
    return {
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
                const corpusIndex = artifactIndex(loaded.artifacts, CORPUS);
                const specifications = corpusIndex.map(({ source, key }) => {
                    const specification = jsonArtifact(loaded.artifacts, key);
                    if (specification.source !== source)
                        throw new Error('Checkpoint specification index drifted.');
                    return specification;
                });
                const statistics = jsonArtifact(loaded.artifacts, STATISTICS);
                const inventory = jsonArtifact(loaded.artifacts, INVENTORY);
                const qualificationIndex = artifactIndex(loaded.artifacts, QUALIFICATIONS);
                const qualifications = qualificationIndex.map(({ source, key }) => {
                    const qualification = jsonArtifact(loaded.artifacts, key);
                    if (qualification.specification.source !== source) {
                        throw new Error('Checkpoint qualification index drifted.');
                    }
                    return qualification;
                });
                const core = record(jsonArtifact(loaded.artifacts, SNAPSHOT));
                if (statistics.repository !== expectation.repository ||
                    statistics.inventory !== expectation.inventory ||
                    inventory.repository !== expectation.repository ||
                    inventory.revision !== expectation.inventory ||
                    !Array.isArray(inventory.files) ||
                    !Array.isArray(statistics.files))
                    return miss('incompatible');
                const bySource = new Map(specifications.map((value) => [value.source, value]));
                const included = stringArray(core.specifications).map((source) => {
                    const specification = bySource.get(source);
                    if (!specification)
                        throw new Error(`Checkpoint specification is missing: ${source}`);
                    return specification;
                });
                const candidate = createApplicationSnapshot({
                    repository: expectation.repository,
                    inventory: expectation.inventory,
                    selection: core.selection,
                    specifications: included,
                    statistics,
                    qualifications,
                    ...(core.analysis === undefined
                        ? {}
                        : { analysis: core.analysis }),
                    diagnostics: array(core.diagnostics),
                    analysisDiagnostics: stringArray(core.analysisDiagnostics),
                });
                if (candidate.id !== payload.snapshot)
                    return miss('incompatible');
                return {
                    ok: true,
                    content: { snapshot: candidate, specifications, inventory, statistics },
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
            const specificationIndex = [...content.specifications]
                .sort((left, right) => left.source.localeCompare(right.source))
                .map((specification) => ({
                source: specification.source,
                key: artifactKey('specification', specification.source),
                value: specification,
            }));
            const qualificationIndex = [...snapshot.qualifications]
                .sort((left, right) => left.specification.source.localeCompare(right.specification.source))
                .map((qualification) => ({
                source: qualification.specification.source,
                key: artifactKey('qualification', qualification.specification.source),
                value: qualification,
            }));
            const artifacts = new Map([
                [CORPUS, jsonBytes(specificationIndex.map(({ source, key }) => ({ source, key })))],
                [STATISTICS, jsonBytes(content.statistics)],
                [INVENTORY, jsonBytes(content.inventory)],
                [QUALIFICATIONS, jsonBytes(qualificationIndex.map(({ source, key }) => ({ source, key })))],
                [
                    SNAPSHOT,
                    jsonBytes({
                        selection: snapshot.selection,
                        specifications: snapshot.specifications.map((value) => value.source),
                        analysis: snapshot.analysis,
                        diagnostics: snapshot.diagnostics,
                        analysisDiagnostics: snapshot.analysisDiagnostics,
                    }),
                ],
            ]);
            for (const { key, value } of specificationIndex)
                artifacts.set(key, jsonBytes(value));
            for (const { key, value } of qualificationIndex)
                artifacts.set(key, jsonBytes(value));
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
                    },
                },
                artifacts,
            }, signalOptions(expectation));
        },
    };
}
function checkpointScope(expectation) {
    return `${SCOPE_PREFIX}${createHash('sha256').update(expectation.request).digest('hex').slice(0, 32)}`;
}
function signalOptions(expectation) {
    return expectation.signal ? { signal: expectation.signal } : {};
}
function jsonBytes(value) {
    return Buffer.from(JSON.stringify(value), 'utf8');
}
function jsonArtifact(artifacts, key) {
    const bytes = artifacts.get(key);
    if (!bytes)
        throw new Error(`Checkpoint artifact is missing: ${key}`);
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
function artifactIndex(artifacts, key) {
    const value = jsonArtifact(artifacts, key);
    if (!Array.isArray(value) ||
        !value.every((entry) => recordOrUndefined(entry) !== undefined &&
            typeof recordOrUndefined(entry)?.source === 'string' &&
            typeof recordOrUndefined(entry)?.key === 'string'))
        throw new TypeError('Checkpoint artifact index is invalid.');
    return value;
}
function artifactKey(kind, source) {
    return `${kind}/${createHash('sha256').update(source).digest('hex')}.json`;
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
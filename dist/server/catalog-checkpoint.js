import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { TYPE_SPEC_APPLICATION_LIMITS } from '../application/limits.js';
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.js';
import { CATALOG_SOURCE_FORMAT, CATALOG_INDEX_FORMAT, CATALOG_SPEC_FORMAT, CATALOG_TRANSPORT_VERSION, } from '../viewer-host/catalog.js';
import { createFileWorkspaceCheckpointStore, decodeWorkspaceCheckpointJson, encodeWorkspaceCheckpointJson, WORKSPACE_CHECKPOINT_JSON_ENCODING, } from '../workspace/checkpoint/index.js';
import { catalogProjectionFromPayloads, catalogProjectionTopology, createCatalogIndexModule, } from './catalog-snapshot.js';
const FORMAT = 'astrale.codegraph.viewer-catalog-checkpoint';
const VERSION = 4;
const LEGACY_VERSION = 3;
const CATALOG = 'viewer/catalog-transport-index.json.br';
const CATALOG_SCOPE = 'viewer-catalog';
const VERIFICATION_SCOPE = 'viewer-verification';
const VERIFICATIONS = 'viewer/verifications.json.br';
const SPEC_PAYLOAD_CACHE = 16;
const SOURCE_PAYLOAD_CACHE = 128;
/** Derived server transport cache; it has no authority over application or analysis state. */
export async function createServerCatalogCheckpoint(root) {
    const store = createFileWorkspaceCheckpointStore({
        directory: join(defaultTypeSpecCacheDirectory(), 'workspaces', createHash('sha256').update(resolve(root)).digest('hex'), 'viewer'),
        maxArtifacts: 4_096,
        maximumScopes: 4,
    });
    const producer = `@astrale-os/codegraph@${await codegraphVersion()}:viewer-catalog/4`;
    return checkpoint(store, producer);
}
function checkpoint(store, producerFingerprint) {
    let verificationDigest;
    let persistedCatalog;
    const legacyProducerFingerprint = producerFingerprint.replace(/\/4$/u, '/3');
    let service;
    service = {
        async load(snapshot, adapter) {
            try {
                const loaded = await store.load(CATALOG_SCOPE);
                if (!loaded.ok ||
                    loaded.manifest.format !== FORMAT ||
                    (loaded.manifest.version !== VERSION && loaded.manifest.version !== LEGACY_VERSION) ||
                    !validProducer(loaded.manifest.version, loaded.manifest.producerFingerprint, producerFingerprint, legacyProducerFingerprint) ||
                    !isRecord(loaded.manifest.payload) ||
                    loaded.manifest.payload.snapshot !== snapshot ||
                    loaded.manifest.payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
                    !validDecodedBytes(loaded.manifest.payload.decodedBytes))
                    return;
                const bytes = loaded.artifacts.get(CATALOG);
                if (!bytes)
                    return;
                const decoded = decodeArtifact(bytes);
                const seed = decoded.value;
                if (!isRecord(seed) ||
                    !isCatalogIndex(seed.index, snapshot) ||
                    typeof seed.topology !== 'string' ||
                    !Array.isArray(seed.specs) ||
                    !Array.isArray(seed.sources))
                    return;
                const specs = payloadDescriptors(seed.specs);
                const sources = payloadDescriptors(seed.sources);
                if ([...specs, ...sources].some((descriptor) => !loaded.artifacts.has(descriptor.artifact)))
                    return;
                const sourceKeys = new Set(sources.map((value) => value.key));
                const declaredBytes = decoded.decodedBytes + descriptorBytes(specs) + descriptorBytes(sources);
                assertDecodedCheckpointBytes(declaredBytes);
                if (declaredBytes !== loaded.manifest.payload.decodedBytes)
                    return;
                assertIndexPayloads(seed.index, specs);
                const specPayloads = new LazyCheckpointMap(specs, loaded.artifacts, SPEC_PAYLOAD_CACHE, (value, key) => admitSpecPayload(value, key, sourceKeys));
                const sourcePayloads = new LazyCheckpointMap(sources, loaded.artifacts, SOURCE_PAYLOAD_CACHE, admitSourcePayload);
                const projection = isRecord(seed.projection)
                    ? admitProjection(seed.projection, seed.index)
                    : catalogProjectionFromPayloads(seed.index, specPayloads);
                const topology = catalogProjectionTopology(projection.specifications);
                if (isRecord(seed.projection) && topology !== seed.topology)
                    return;
                persistedCatalog = {
                    specs: new Map(specs.map((value) => [value.key, value])),
                    sources: new Map(sources.map((value) => [value.key, value])),
                    artifacts: loaded.artifacts,
                };
                const restored = {
                    index: seed.index,
                    indexModule: createCatalogIndexModule(seed.index, adapter),
                    specs: specPayloads,
                    sources: sourcePayloads,
                    inputs: new Map(),
                    projection,
                    topology,
                };
                if (loaded.manifest.version === LEGACY_VERSION)
                    await service.publish(restored);
                return restored;
            }
            catch {
                return;
            }
        },
        async publish(snapshot) {
            try {
                const artifacts = new Map();
                let decodedBytes = 0;
                const add = (key, value) => {
                    const encoded = encodeArtifact(value);
                    decodedBytes += encoded.decodedBytes;
                    assertDecodedCheckpointBytes(decodedBytes);
                    artifacts.set(key, encoded.value);
                    return encoded.decodedBytes;
                };
                const addPayload = (kind, key, values, retained) => {
                    const existing = retained?.get(key);
                    const existingBytes = existing && persistedCatalog?.artifacts.get(existing.artifact);
                    if (existing && existingBytes) {
                        decodedBytes += existing.decodedBytes;
                        assertDecodedCheckpointBytes(decodedBytes);
                        artifacts.set(existing.artifact, existingBytes);
                        return existing;
                    }
                    const artifact = catalogArtifactKey(kind, key);
                    const value = values.get(key);
                    if (value === undefined)
                        throw new Error(`Catalog payload ${key} is missing.`);
                    return { key, artifact, decodedBytes: add(artifact, value) };
                };
                const specDescriptors = [...snapshot.specs.keys()].map((key) => addPayload('specification', key, snapshot.specs, persistedCatalog?.specs));
                const sourceDescriptors = [...snapshot.sources.keys()].map((key) => addPayload('source', key, snapshot.sources, persistedCatalog?.sources));
                add(CATALOG, {
                    index: snapshot.index,
                    topology: snapshot.topology,
                    projection: snapshot.projection,
                    specs: specDescriptors,
                    sources: sourceDescriptors,
                });
                await store.publish(CATALOG_SCOPE, {
                    manifest: {
                        format: FORMAT,
                        version: VERSION,
                        producerFingerprint,
                        payload: {
                            snapshot: snapshot.index.snapshot,
                            encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
                            decodedBytes,
                        },
                    },
                    artifacts,
                });
                persistedCatalog = {
                    specs: new Map(specDescriptors.map((value) => [value.key, value])),
                    sources: new Map(sourceDescriptors.map((value) => [value.key, value])),
                    artifacts,
                };
            }
            catch {
                // Presentation persistence is advisory and never blocks a coherent live catalog.
            }
        },
        async loadVerifications() {
            try {
                const loaded = await store.load(VERIFICATION_SCOPE);
                if (!loaded.ok ||
                    loaded.manifest.format !== FORMAT ||
                    (loaded.manifest.version !== VERSION && loaded.manifest.version !== LEGACY_VERSION) ||
                    !validProducer(loaded.manifest.version, loaded.manifest.producerFingerprint, producerFingerprint, legacyProducerFingerprint) ||
                    !isRecord(loaded.manifest.payload) ||
                    loaded.manifest.payload.encoding !== WORKSPACE_CHECKPOINT_JSON_ENCODING ||
                    !validDecodedBytes(loaded.manifest.payload.decodedBytes))
                    return [];
                const bytes = loaded.artifacts.get(VERIFICATIONS);
                if (!bytes)
                    return [];
                const decoded = decodeArtifact(bytes);
                if (decoded.decodedBytes !== loaded.manifest.payload.decodedBytes)
                    return [];
                const values = decoded.value;
                if (!Array.isArray(values))
                    return [];
                verificationDigest = createHash('sha256').update(bytes).digest('hex');
                return values.filter(isVerificationCheckpoint);
            }
            catch {
                return [];
            }
        },
        async publishVerifications(values) {
            try {
                const encoded = encodeArtifact(values);
                const bytes = encoded.value;
                const digest = createHash('sha256').update(bytes).digest('hex');
                if (digest === verificationDigest)
                    return;
                await store.publish(VERIFICATION_SCOPE, {
                    manifest: {
                        format: FORMAT,
                        version: VERSION,
                        producerFingerprint,
                        payload: {
                            records: values.length,
                            encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
                            decodedBytes: encoded.decodedBytes,
                        },
                    },
                    artifacts: { [VERIFICATIONS]: bytes },
                });
                verificationDigest = digest;
            }
            catch {
                // Verification projection persistence is advisory.
            }
        },
        dispose: () => store.dispose(),
    };
    return service;
}
class LazyCheckpointMap {
    #descriptors;
    #artifacts;
    #cache = new Map();
    #capacity;
    #admit;
    constructor(descriptors, artifacts, capacity, admit) {
        this.#descriptors = new Map(descriptors.map((value) => [value.key, value]));
        this.#artifacts = artifacts;
        this.#capacity = capacity;
        this.#admit = admit;
    }
    get size() {
        return this.#descriptors.size;
    }
    has(key) {
        return this.#descriptors.has(key);
    }
    get(key) {
        const cached = this.#cache.get(key);
        if (cached !== undefined) {
            this.#cache.delete(key);
            this.#cache.set(key, cached);
            return cached;
        }
        const descriptor = this.#descriptors.get(key);
        if (!descriptor)
            return;
        const bytes = this.#artifacts.get(descriptor.artifact);
        if (!bytes)
            throw new Error(`Catalog checkpoint is missing ${descriptor.artifact}.`);
        const decoded = decodeArtifact(bytes);
        if (decoded.decodedBytes !== descriptor.decodedBytes) {
            throw new Error(`Catalog checkpoint decoded size drifted for ${descriptor.artifact}.`);
        }
        const value = this.#admit(decoded.value, key);
        this.#cache.set(key, value);
        while (this.#cache.size > this.#capacity)
            this.#cache.delete(this.#cache.keys().next().value);
        return value;
    }
    keys() {
        return this.#descriptors.keys();
    }
    values() {
        return this.materialize().values();
    }
    entries() {
        return this.materialize().entries();
    }
    forEach(callbackfn, thisArg) {
        for (const key of this.#descriptors.keys())
            callbackfn.call(thisArg, this.get(key), key, this);
    }
    [Symbol.iterator]() {
        return this.entries();
    }
    materialize() {
        return new Map([...this.#descriptors.keys()].map((key) => [key, this.get(key)]));
    }
}
function payloadDescriptors(value) {
    const output = [];
    const keys = new Set();
    const artifacts = new Set();
    for (const entry of value) {
        if (!isRecord(entry) ||
            typeof entry.key !== 'string' ||
            typeof entry.artifact !== 'string' ||
            !Number.isSafeInteger(entry.decodedBytes) ||
            entry.decodedBytes < 0 ||
            entry.decodedBytes >
                TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes ||
            keys.has(entry.key) ||
            artifacts.has(entry.artifact))
            throw new TypeError('Catalog checkpoint payload descriptor is invalid.');
        keys.add(entry.key);
        artifacts.add(entry.artifact);
        output.push({
            key: entry.key,
            artifact: entry.artifact,
            decodedBytes: entry.decodedBytes,
        });
    }
    return output;
}
function descriptorBytes(values) {
    return values.reduce((total, value) => {
        const next = total + value.decodedBytes;
        assertDecodedCheckpointBytes(next);
        return next;
    }, 0);
}
function assertIndexPayloads(index, specifications) {
    const payloads = new Set(specifications.map((value) => value.key));
    if (payloads.size !== index.specs.length) {
        throw new Error('Catalog checkpoint specification payload count drifted.');
    }
    for (const entry of index.specs) {
        if (!payloads.has(`${entry.source}\0${entry.revision}`)) {
            throw new Error(`Catalog checkpoint is missing the indexed payload for ${entry.source}.`);
        }
    }
}
function admitProjection(value, index) {
    if (!Array.isArray(value.specifications) || !Array.isArray(value.sourceKeys)) {
        throw new TypeError('Catalog checkpoint projection context is invalid.');
    }
    const specifications = value.specifications.map(admitProjectionSpecification);
    const sourceKeys = value.sourceKeys.map((entry) => {
        if (!isRecord(entry) ||
            typeof entry.source !== 'string' ||
            !Array.isArray(entry.keys) ||
            !entry.keys.every((key) => typeof key === 'string') ||
            new Set(entry.keys).size !== entry.keys.length)
            throw new TypeError('Catalog checkpoint projection source keys are invalid.');
        return { source: entry.source, keys: entry.keys };
    });
    const indexedSources = index.specs.map((entry) => entry.source);
    if (!sameStrings(specifications.map((entry) => entry.source), indexedSources) ||
        !sameStrings(sourceKeys.map((entry) => entry.source), indexedSources))
        throw new TypeError('Catalog checkpoint projection inventory drifted.');
    return { specifications, sourceKeys };
}
function admitProjectionSpecification(value) {
    if (!isRecord(value) || typeof value.source !== 'string' || !Array.isArray(value.modules)) {
        throw new TypeError('Catalog checkpoint projection specification is invalid.');
    }
    const modules = value.modules.map((module) => {
        if (!isRecord(module) ||
            typeof module.id !== 'string' ||
            typeof module.name !== 'string' ||
            typeof module.declarationPointer !== 'string' ||
            !Array.isArray(module.imports) ||
            !module.imports.every((item) => isRecord(item) && typeof item.key === 'string' && typeof item.source === 'string'))
            throw new TypeError('Catalog checkpoint projection module is invalid.');
        const api = module.api === undefined ? undefined : admitProjectionApi(module.api);
        return {
            id: module.id,
            name: module.name,
            declarationPointer: module.declarationPointer,
            ...(api ? { api } : {}),
            imports: module.imports,
        };
    });
    return { source: value.source, modules };
}
function admitProjectionApi(value) {
    if (!isRecord(value) || !isRecord(value.model)) {
        throw new TypeError('Catalog checkpoint projection API is invalid.');
    }
    const model = value.model;
    if (typeof model.entrypoint !== 'string' ||
        !isRecord(model.surface) ||
        !Array.isArray(model.surface.declarations) ||
        !Array.isArray(model.surface.exports))
        throw new TypeError('Catalog checkpoint projection API model is invalid.');
    const declarations = model.surface.declarations.map((declaration) => {
        if (!isRecord(declaration) ||
            typeof declaration.identity !== 'string' ||
            !isRecord(declaration.location) ||
            !Number.isSafeInteger(declaration.location.line) ||
            !Number.isSafeInteger(declaration.location.column) ||
            !(typeof declaration.location.file === 'string' ||
                typeof declaration.location.external === 'string'))
            throw new TypeError('Catalog checkpoint projection declaration is invalid.');
        return declaration;
    });
    const exports = model.surface.exports.map((item) => {
        if (!isRecord(item) || typeof item.declaration !== 'string') {
            throw new TypeError('Catalog checkpoint projection export is invalid.');
        }
        if (!Array.isArray(item.path) || !item.path.every((part) => typeof part === 'string')) {
            throw new TypeError('Catalog checkpoint projection export path is invalid.');
        }
        return { declaration: item.declaration, path: item.path };
    });
    return { model: { entrypoint: model.entrypoint, surface: { declarations, exports } } };
}
function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function isCatalogIndex(value, snapshot) {
    return (isRecord(value) &&
        value.format === CATALOG_INDEX_FORMAT &&
        value.version === CATALOG_TRANSPORT_VERSION &&
        value.snapshot === snapshot &&
        typeof value.generation === 'string' &&
        Array.isArray(value.specs) &&
        value.specs.every((entry) => isRecord(entry) &&
            typeof entry.source === 'string' &&
            typeof entry.revision === 'string') &&
        Array.isArray(value.diagnostics));
}
function admitSpecPayload(value, key, sourceKeys) {
    if (!isRecord(value) ||
        value.format !== CATALOG_SPEC_FORMAT ||
        value.version !== CATALOG_TRANSPORT_VERSION ||
        typeof value.source !== 'string' ||
        typeof value.revision !== 'string' ||
        `${value.source}\0${value.revision}` !== key ||
        !isRecord(value.spec))
        throw new TypeError('Catalog checkpoint specification payload is invalid.');
    for (const sourceKey of packedSourceKeys(value.spec)) {
        if (!sourceKeys.has(sourceKey)) {
            throw new Error(`Catalog checkpoint is missing source payload ${sourceKey}.`);
        }
    }
    return value;
}
function packedSourceKeys(specification) {
    if (!Array.isArray(specification.modules))
        return [];
    const output = [];
    for (const module of specification.modules) {
        if (!isRecord(module))
            throw new TypeError('Catalog checkpoint packed module is invalid.');
        collectModelSourceKeys(isRecord(module.api) ? module.api.model : undefined, output);
        if (!Array.isArray(module.ports))
            throw new TypeError('Catalog checkpoint packed ports are invalid.');
        for (const port of module.ports) {
            if (!isRecord(port))
                throw new TypeError('Catalog checkpoint packed port is invalid.');
            collectModelSourceKeys(port.model, output);
        }
    }
    return output;
}
function collectModelSourceKeys(value, output) {
    if (value === undefined)
        return;
    if (!isRecord(value) || !Array.isArray(value.sourceKeys)) {
        throw new TypeError('Catalog checkpoint packed API model is invalid.');
    }
    for (const key of value.sourceKeys) {
        if (typeof key !== 'string')
            throw new TypeError('Catalog checkpoint source key is invalid.');
        output.push(key);
    }
}
function admitSourcePayload(value, key) {
    if (!isRecord(value) ||
        value.format !== CATALOG_SOURCE_FORMAT ||
        value.version !== CATALOG_TRANSPORT_VERSION ||
        value.key !== key ||
        !isRecord(value.source) ||
        !Array.isArray(value.tokens))
        throw new TypeError('Catalog checkpoint source payload is invalid.');
    return value;
}
function catalogArtifactKey(kind, identity) {
    return `viewer/${kind}/${createHash('sha256').update(identity).digest('hex')}.json.br`;
}
function encodeArtifact(value) {
    return encodeWorkspaceCheckpointJson(value, {
        maximumDecodedBytes: TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes,
    });
}
function decodeArtifact(bytes) {
    return decodeWorkspaceCheckpointJson(bytes, {
        maximumDecodedBytes: TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes,
    });
}
function validDecodedBytes(value) {
    return (Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointBytes);
}
function validProducer(version, actual, current, legacy) {
    return actual === current || (version === LEGACY_VERSION && actual === legacy);
}
function assertDecodedCheckpointBytes(value) {
    if (value > TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointBytes) {
        throw new RangeError('Viewer catalog checkpoint exceeds its decoded byte budget.');
    }
}
async function codegraphVersion() {
    const candidate = resolve(import.meta.dirname, '..');
    const packageRoot = basename(candidate) === 'dist' ? dirname(candidate) : candidate;
    const value = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (!isRecord(value) ||
        typeof value.version !== 'string' ||
        !value.version.trim())
        throw new Error('Installed @astrale-os/codegraph package has no version.');
    return value.version;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isVerificationCheckpoint(value) {
    return (isRecord(value) &&
        typeof value.source === 'string' &&
        typeof value.revision === 'string' &&
        typeof value.inputs === 'string' &&
        isViewerQualification(value.verification));
}
function isViewerQualification(value) {
    return (isRecord(value) &&
        isQualificationStatus(value.status) &&
        typeof value.durationMs === 'number' &&
        Number.isFinite(value.durationMs) &&
        value.durationMs >= 0 &&
        Array.isArray(value.dependencies) &&
        value.dependencies.every((entry) => typeof entry === 'string') &&
        Array.isArray(value.rules) &&
        value.rules.every(isQualificationRule) &&
        Array.isArray(value.profiles) &&
        value.profiles.every((profile) => isRecord(profile) &&
            typeof profile.id === 'string' &&
            typeof profile.provider === 'string' &&
            isQualificationStatus(profile.status) &&
            Array.isArray(profile.rules) &&
            profile.rules.every(isQualificationRule)));
}
function isQualificationRule(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        isQualificationStatus(value.status) &&
        Array.isArray(value.diagnostics) &&
        value.diagnostics.every((diagnostic) => isRecord(diagnostic) &&
            typeof diagnostic.message === 'string' &&
            (diagnostic.severity === undefined ||
                diagnostic.severity === 'error' ||
                diagnostic.severity === 'warning' ||
                diagnostic.severity === 'info')));
}
function isQualificationStatus(value) {
    return value === 'pass' || value === 'fail' || value === 'idle' || value === 'error';
}
//# sourceMappingURL=catalog-checkpoint.js.map
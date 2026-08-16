import { createHash } from 'node:crypto';
import { DEFAULT_WORKSPACE_CHECKPOINT_LIMITS } from './model.js';
export const SHA256 = /^[a-f0-9]{64}$/u;
export const MAX_SCOPE_LENGTH = 128;
export const MAX_ARTIFACT_KEY_BYTES = 16 * 1024;
export function normalizeLimits(options) {
    const limits = {
        maxManifestBytes: options.maxManifestBytes ?? DEFAULT_WORKSPACE_CHECKPOINT_LIMITS.maxManifestBytes,
        maxArtifactBytes: options.maxArtifactBytes ?? DEFAULT_WORKSPACE_CHECKPOINT_LIMITS.maxArtifactBytes,
        maxArtifacts: options.maxArtifacts ?? DEFAULT_WORKSPACE_CHECKPOINT_LIMITS.maxArtifacts,
        maxTotalBytes: options.maxTotalBytes ?? DEFAULT_WORKSPACE_CHECKPOINT_LIMITS.maxTotalBytes,
        maximumScopes: options.maximumScopes ?? DEFAULT_WORKSPACE_CHECKPOINT_LIMITS.maximumScopes,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError(`${name} must be a non-negative safe integer.`);
        }
    }
    if (limits.maximumScopes < 1) {
        throw new TypeError('maximumScopes must be a positive safe integer.');
    }
    return limits;
}
export function validateScope(scope) {
    if (typeof scope !== 'string' ||
        scope.length === 0 ||
        scope.length > MAX_SCOPE_LENGTH ||
        !/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u.test(scope)) {
        throw new TypeError('Checkpoint scopes must be lowercase safe identifiers.');
    }
    return scope;
}
export function preparePublication(scope, input, limits) {
    if (!isRecord(input) || !isRecord(input.manifest))
        throw new TypeError('Checkpoint manifest is required.');
    const source = input.manifest;
    if (source.scope !== undefined && source.scope !== scope) {
        throw new TypeError('Checkpoint manifest scope does not match the publication scope.');
    }
    const rawArtifacts = normalizeArtifacts(input.artifacts);
    if (rawArtifacts.length > limits.maxArtifacts) {
        throw new RangeError(`Checkpoint contains more than ${limits.maxArtifacts} artifacts.`);
    }
    const seenKeys = new Set();
    const seenDigests = new Set();
    const artifacts = [];
    let totalBytes = 0;
    for (const item of rawArtifacts) {
        validateArtifactKey(item.key);
        if (seenKeys.has(item.key))
            throw new TypeError(`Checkpoint artifact key is duplicated: ${item.key}`);
        seenKeys.add(item.key);
        if (!(item.bytes instanceof Uint8Array))
            throw new TypeError(`Checkpoint artifact ${item.key} is not bytes.`);
        const data = Uint8Array.from(item.bytes);
        if (data.byteLength > limits.maxArtifactBytes) {
            throw new RangeError(`Checkpoint artifact ${item.key} exceeds maxArtifactBytes.`);
        }
        const artifactDigest = sha256(data);
        if (!seenDigests.has(artifactDigest)) {
            totalBytes += data.byteLength;
            if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
                throw new RangeError('Checkpoint artifacts exceed maxTotalBytes.');
            }
            seenDigests.add(artifactDigest);
        }
        artifacts.push({
            key: item.key,
            digest: artifactDigest,
            bytes: data.byteLength,
            data,
        });
    }
    artifacts.sort((left, right) => compareCodePoints(left.key, right.key));
    const manifest = buildManifest(source, scope, artifacts);
    const serialized = canonicalJson(manifest);
    const bytes = Buffer.from(serialized, 'utf8');
    if (bytes.byteLength > limits.maxManifestBytes) {
        throw new RangeError('Checkpoint manifest exceeds maxManifestBytes.');
    }
    return { artifacts, bytes };
}
function buildManifest(source, scope, artifacts) {
    // Retain caller metadata, while the store replaces only the scope and physical descriptors.
    const manifest = { ...source };
    manifest.scope = scope;
    manifest.artifacts = artifacts.map(({ key, digest, bytes }) => ({ key, digest, bytes }));
    validateManifestFields(manifest, scope, false);
    return manifest;
}
function normalizeArtifacts(input) {
    if (input instanceof Map) {
        return [...input.entries()].map(([key, bytes]) => ({ key, bytes }));
    }
    if (Array.isArray(input)) {
        return input.map((entry) => {
            if (Array.isArray(entry)) {
                if (entry.length !== 2)
                    throw new TypeError('Checkpoint artifact tuples must have two items.');
                if (typeof entry[0] !== 'string' || !(entry[1] instanceof Uint8Array)) {
                    throw new TypeError('Checkpoint artifact tuples must contain a string key and bytes.');
                }
                return { key: entry[0], bytes: entry[1] };
            }
            if (isRecord(entry) && typeof entry.key === 'string' && entry.bytes instanceof Uint8Array) {
                return { key: entry.key, bytes: entry.bytes };
            }
            throw new TypeError('Checkpoint artifact entries must contain key and bytes.');
        });
    }
    if (!isRecord(input))
        throw new TypeError('Checkpoint artifacts must be a map, object, or list.');
    const objectInput = input;
    return Object.keys(objectInput).map((key) => ({ key, bytes: objectInput[key] }));
}
function validateArtifactKey(key) {
    if (typeof key !== 'string' || key.length === 0 || key.includes('\0')) {
        throw new TypeError('Checkpoint artifact keys must be non-empty logical strings.');
    }
    if (Buffer.byteLength(key, 'utf8') > MAX_ARTIFACT_KEY_BYTES) {
        throw new RangeError('Checkpoint artifact key is too large.');
    }
}
export function validateStoredManifest(value, scope, limits) {
    if (!isRecord(value))
        throw new TypeError('Checkpoint manifest is not an object.');
    validateManifestFields(value, scope, true);
    if (!Array.isArray(value.artifacts))
        throw new TypeError('Checkpoint manifest artifacts are invalid.');
    if (value.artifacts.length > limits.maxArtifacts)
        throw new RangeError('Checkpoint artifact count is too large.');
    const descriptors = [];
    const seenKeys = new Set();
    const seenDigests = new Set();
    let totalBytes = 0;
    let previousKey;
    for (const item of value.artifacts) {
        if (!isRecord(item))
            throw new TypeError('Checkpoint artifact descriptor is invalid.');
        if (typeof item.key !== 'string' || typeof item.digest !== 'string' || typeof item.bytes !== 'number') {
            throw new TypeError('Checkpoint artifact descriptor fields are invalid.');
        }
        validateArtifactKey(item.key);
        if (!SHA256.test(item.digest))
            throw new TypeError('Checkpoint artifact digest is invalid.');
        if (!Number.isSafeInteger(item.bytes) || item.bytes < 0) {
            throw new TypeError('Checkpoint artifact byte count is invalid.');
        }
        if (item.bytes > limits.maxArtifactBytes)
            throw new RangeError('Checkpoint artifact is too large.');
        if (seenKeys.has(item.key))
            throw new TypeError('Checkpoint artifact keys are duplicated.');
        if (previousKey !== undefined && compareCodePoints(previousKey, item.key) >= 0) {
            throw new TypeError('Checkpoint artifact descriptors are not sorted.');
        }
        previousKey = item.key;
        seenKeys.add(item.key);
        if (!seenDigests.has(item.digest)) {
            totalBytes += item.bytes;
            if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
                throw new RangeError('Checkpoint artifacts exceed maxTotalBytes.');
            }
            seenDigests.add(item.digest);
        }
        descriptors.push({ key: item.key, digest: item.digest, bytes: item.bytes });
    }
    return {
        ...value,
        artifacts: descriptors,
    };
}
function validateManifestFields(value, scope, stored) {
    if (typeof value.format !== 'string' || value.format.length === 0) {
        throw new TypeError('Checkpoint manifest format is invalid.');
    }
    if (!Number.isSafeInteger(value.version) || value.version < 0) {
        throw new TypeError('Checkpoint manifest version is invalid.');
    }
    if (value.scope !== scope)
        throw new TypeError('Checkpoint manifest scope is invalid.');
    if (!Object.hasOwn(value, 'payload'))
        throw new TypeError('Checkpoint manifest payload is missing.');
    assertJsonValue(value.payload);
    const hasFingerprint = typeof value.producerFingerprint === 'string' && value.producerFingerprint.length > 0;
    const hasProducer = (typeof value.producer === 'string' && value.producer.length > 0) ||
        (isRecord(value.producer) &&
            typeof value.producer.fingerprint === 'string' &&
            value.producer.fingerprint.length > 0);
    if (!hasFingerprint && !hasProducer)
        throw new TypeError('Checkpoint producer fingerprint is missing.');
    if (value.producerFingerprint !== undefined && typeof value.producerFingerprint !== 'string') {
        throw new TypeError('Checkpoint producer fingerprint is invalid.');
    }
    if (value.producer !== undefined)
        assertJsonValue(value.producer);
    if (stored && !Array.isArray(value.artifacts))
        throw new TypeError('Checkpoint manifest artifacts are missing.');
}
function assertJsonValue(value, active = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new TypeError('Checkpoint JSON values must be finite.');
        return;
    }
    if (Array.isArray(value)) {
        if (active.has(value))
            throw new TypeError('Checkpoint JSON values cannot be cyclic.');
        active.add(value);
        for (const item of value)
            assertJsonValue(item, active);
        active.delete(value);
        return;
    }
    if (typeof value === 'object') {
        if (active.has(value))
            throw new TypeError('Checkpoint JSON values cannot be cyclic.');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('Checkpoint JSON values must contain plain objects only.');
        }
        active.add(value);
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined)
                throw new TypeError(`Checkpoint JSON value ${key} is undefined.`);
            assertJsonValue(item, active);
        }
        active.delete(value);
        return;
    }
    throw new TypeError('Checkpoint values must be JSON-compatible.');
}
export function canonicalJson(value, active = new WeakSet()) {
    assertJsonValue(value);
    return canonicalJsonValue(value, active);
}
function canonicalJsonValue(value, active) {
    if (value === null)
        return 'null';
    if (typeof value === 'string')
        return canonicalString(value);
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return JSON.stringify(Object.is(value, -0) ? 0 : value);
    if (active.has(value))
        throw new TypeError('Checkpoint JSON values cannot be cyclic.');
    active.add(value);
    try {
        if (Array.isArray(value))
            return `[${value.map((item) => canonicalJsonValue(item, active)).join(',')}]`;
        return `{${Object.keys(value)
            .sort(compareCodePoints)
            .map((key) => `${canonicalString(key)}:${canonicalJsonValue(value[key], active)}`)
            .join(',')}}`;
    }
    finally {
        active.delete(value);
    }
}
function canonicalString(value) {
    return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}
export function compareCodePoints(left, right) {
    if (left === right)
        return 0;
    return left < right ? -1 : 1;
}
export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isAbort(error) {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
export function throwIfAborted(signal, error) {
    if (error !== undefined && isAbort(error))
        throw error;
    if (signal?.aborted) {
        const abortError = new Error('The checkpoint operation was aborted.');
        abortError.name = 'AbortError';
        throw abortError;
    }
}
//# sourceMappingURL=validation.js.map
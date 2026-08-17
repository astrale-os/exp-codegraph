import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm, } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SHA256, canonicalJson, isAbort, isRecord, normalizeLimits, preparePublication, sha256, throwIfAborted, validateScope, validateStoredManifest, } from './validation.js';
const TEMPORARY_AGE_MS = 24 * 60 * 60 * 1_000;
const LOAD_CONCURRENCY = 32;
/** Create a generic advisory filesystem-backed checkpoint store. */
export function createFileWorkspaceCheckpointStore(options) {
    const limits = normalizeLimits(options);
    const directory = resolve(options.directory);
    const manifestDirectory = join(directory, 'manifests');
    const blobDirectory = join(directory, 'blobs', 'sha256');
    const defaultSignal = options.signal;
    // Digests admitted by load or installed by this store do not need their immutable blob file read
    // and hashed again on the next delta publication. Caller bytes are still copied and hashed before
    // this proof is consulted, so mutating a previously returned Uint8Array cannot alias stale data.
    const trustedBlobs = new Map();
    const maximumTrustedBlobs = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, limits.maxArtifacts * 2));
    let disposed = false;
    const assertReady = (signal) => {
        if (disposed)
            throw new Error('Workspace checkpoint store has been disposed.');
        throwIfAborted(signal ?? defaultSignal);
    };
    const operationSignal = (signal) => signal ?? defaultSignal;
    return {
        async load(scope, operationOptions = {}) {
            const signal = operationSignal(operationOptions.signal);
            assertReady(signal);
            const validatedScope = validateScope(scope);
            const target = manifestPath(manifestDirectory, validatedScope);
            let bytes;
            try {
                const metadata = await lstat(target);
                throwIfAborted(signal);
                if (!metadata.isFile())
                    return miss('manifest-invalid');
                if (metadata.size > limits.maxManifestBytes)
                    return miss('manifest-too-large');
                bytes = await readFile(target, { signal });
            }
            catch (error) {
                throwIfAborted(signal, error);
                if (isMissing(error))
                    return miss('manifest-missing');
                return miss('manifest-unreadable');
            }
            throwIfAborted(signal);
            if (bytes.byteLength > limits.maxManifestBytes)
                return miss('manifest-too-large');
            let parsed;
            try {
                parsed = JSON.parse(bytes.toString('utf8'));
            }
            catch {
                return miss('manifest-invalid');
            }
            let manifest;
            try {
                manifest = validateStoredManifest(parsed, validatedScope, limits);
                const canonical = canonicalJson(manifest);
                if (Buffer.byteLength(canonical, 'utf8') !== bytes.byteLength || canonical !== bytes.toString('utf8')) {
                    return miss('manifest-invalid');
                }
            }
            catch {
                return miss('manifest-invalid');
            }
            const artifacts = new Map();
            let totalBytes = 0;
            const seenDigests = new Set();
            for (const descriptor of manifest.artifacts) {
                throwIfAborted(signal);
                if (descriptor.bytes > limits.maxArtifactBytes)
                    return miss('artifact-too-large');
                if (!seenDigests.has(descriptor.digest)) {
                    totalBytes += descriptor.bytes;
                    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
                        return miss('artifacts-too-large');
                    }
                    seenDigests.add(descriptor.digest);
                }
            }
            const unique = new Map();
            for (const descriptor of manifest.artifacts) {
                if (!unique.has(descriptor.digest))
                    unique.set(descriptor.digest, descriptor);
            }
            const loaded = await mapConcurrent([...unique.values()], LOAD_CONCURRENCY, (descriptor) => loadBlob(blobDirectory, descriptor, limits, signal));
            const failed = loaded.find((result) => !result.ok);
            if (failed)
                return miss(failed.reason);
            const successful = loaded.filter((result) => result.ok);
            const loadedByDigest = new Map(successful.map((result) => [result.digest, result.bytes]));
            for (const result of successful) {
                rememberTrustedBlob(trustedBlobs, result.digest, result.metadata, maximumTrustedBlobs);
            }
            for (const descriptor of manifest.artifacts) {
                const artifactBytes = loadedByDigest.get(descriptor.digest);
                if (!artifactBytes)
                    return miss('artifact-missing');
                artifacts.set(descriptor.key, artifactBytes);
            }
            return { ok: true, manifest, artifacts };
        },
        async publish(scope, input, operationOptions = {}) {
            const signal = operationSignal(input.signal ?? operationOptions.signal);
            assertReady(signal);
            const validatedScope = validateScope(scope);
            const prepared = preparePublication(validatedScope, input, limits);
            throwIfAborted(signal);
            await mkdir(manifestDirectory, { recursive: true, mode: 0o700 });
            await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
            throwIfAborted(signal);
            const installedDigests = new Set();
            try {
                for (const artifact of prepared.artifacts) {
                    throwIfAborted(signal);
                    const target = join(blobDirectory, artifact.digest);
                    const trusted = trustedBlobs.get(artifact.digest);
                    if ((trusted && await installedBlobMatchesMetadata(target, trusted, signal)) ||
                        await installedBlobExists(target, artifact.digest, artifact.data, signal, limits)) {
                        installedDigests.add(artifact.digest);
                        await rememberInstalledBlob(trustedBlobs, target, artifact.digest, maximumTrustedBlobs, signal);
                        continue;
                    }
                    const temporary = temporaryPath(blobDirectory, `.${artifact.digest}`);
                    try {
                        await writeDurably(temporary, artifact.data, signal);
                        await installBlob(temporary, target, artifact.digest, artifact.data, signal, limits);
                        installedDigests.add(artifact.digest);
                        await rememberInstalledBlob(trustedBlobs, target, artifact.digest, maximumTrustedBlobs, signal);
                    }
                    finally {
                        await removeQuietly(temporary);
                    }
                }
                throwIfAborted(signal);
                const manifestTarget = manifestPath(manifestDirectory, validatedScope);
                const manifestTemporary = temporaryPath(manifestDirectory, `.${validatedScope}`);
                try {
                    await writeDurably(manifestTemporary, prepared.bytes, signal);
                    await replaceFile(manifestTemporary, manifestTarget);
                    await fsyncDirectory(manifestDirectory);
                }
                finally {
                    await removeQuietly(manifestTemporary);
                }
            }
            finally {
                await pruneBestEffort(manifestDirectory, blobDirectory, limits, installedDigests, validatedScope, signal);
            }
        },
        async remove(scope, operationOptions = {}) {
            const signal = operationSignal(operationOptions.signal);
            assertReady(signal);
            const validatedScope = validateScope(scope);
            throwIfAborted(signal);
            try {
                await rm(manifestPath(manifestDirectory, validatedScope), { force: true });
                await fsyncDirectory(manifestDirectory);
            }
            catch (error) {
                throwIfAborted(signal, error);
                if (!isMissing(error))
                    throw error;
            }
        },
        async dispose() {
            disposed = true;
            trustedBlobs.clear();
        },
    };
}
function manifestPath(directory, scope) {
    return join(directory, `${scope}.json`);
}
function temporaryPath(directory, prefix) {
    return join(directory, `${prefix}.${process.pid}.${randomUUID()}.tmp`);
}
function miss(reason) {
    return { ok: false, reason };
}
async function loadBlob(directory, descriptor, limits, signal) {
    const blob = join(directory, descriptor.digest);
    let bytes;
    let admittedMetadata;
    try {
        const metadata = await lstat(blob);
        throwIfAborted(signal);
        if (!metadata.isFile())
            return { ok: false, reason: 'artifact-unreadable' };
        if (metadata.size > limits.maxArtifactBytes)
            return { ok: false, reason: 'artifact-too-large' };
        if (metadata.size !== descriptor.bytes)
            return { ok: false, reason: 'artifact-corrupt' };
        admittedMetadata = blobMetadata(metadata);
        bytes = await readFile(blob, { signal });
    }
    catch (error) {
        throwIfAborted(signal, error);
        return { ok: false, reason: isMissing(error) ? 'artifact-missing' : 'artifact-unreadable' };
    }
    throwIfAborted(signal);
    if (bytes.byteLength > limits.maxArtifactBytes)
        return { ok: false, reason: 'artifact-too-large' };
    if (bytes.byteLength !== descriptor.bytes || sha256(bytes) !== descriptor.digest) {
        return { ok: false, reason: 'artifact-corrupt' };
    }
    return {
        ok: true,
        digest: descriptor.digest,
        bytes,
        metadata: admittedMetadata,
    };
}
async function mapConcurrent(values, concurrency, operation) {
    const output = new Array(values.length);
    let next = 0;
    const worker = async () => {
        while (next < values.length) {
            const index = next++;
            output[index] = await operation(values[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
    return output;
}
async function writeDurably(file, bytes, signal) {
    throwIfAborted(signal);
    const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
        let offset = 0;
        while (offset < bytes.byteLength) {
            throwIfAborted(signal);
            const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
            offset += result.bytesWritten;
            if (result.bytesWritten === 0)
                throw new Error('Checkpoint temporary file made no write progress.');
        }
        throwIfAborted(signal);
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function installedBlobExists(target, digest, expected, signal, limits) {
    try {
        const metadata = await lstat(target);
        throwIfAborted(signal);
        if (!metadata.isFile() || metadata.size !== expected.byteLength || metadata.size > limits.maxArtifactBytes) {
            return false;
        }
        const bytes = await readFile(target, { signal });
        if (bytes.byteLength !== expected.byteLength || sha256(bytes) !== digest)
            return false;
        return true;
    }
    catch (error) {
        throwIfAborted(signal, error);
        if (isMissing(error))
            return false;
        return false;
    }
}
async function installedBlobMatchesMetadata(target, expected, signal) {
    try {
        const metadata = await lstat(target);
        throwIfAborted(signal);
        return metadata.isFile() && sameBlobMetadata(blobMetadata(metadata), expected);
    }
    catch (error) {
        throwIfAborted(signal, error);
        return false;
    }
}
async function rememberInstalledBlob(trusted, target, digest, capacity, signal) {
    const metadata = await lstat(target);
    throwIfAborted(signal);
    if (!metadata.isFile())
        return;
    rememberTrustedBlob(trusted, digest, blobMetadata(metadata), capacity);
}
function rememberTrustedBlob(trusted, digest, metadata, capacity) {
    trusted.delete(digest);
    trusted.set(digest, metadata);
    while (trusted.size > capacity)
        trusted.delete(trusted.keys().next().value);
}
function blobMetadata(metadata) {
    return {
        dev: metadata.dev,
        ino: metadata.ino,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        ctimeMs: metadata.ctimeMs,
    };
}
function sameBlobMetadata(left, right) {
    return (left.dev === right.dev &&
        left.ino === right.ino &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs);
}
async function installBlob(temporary, target, digest, expected, signal, limits) {
    throwIfAborted(signal);
    const existing = await blobMatches(target, digest, expected, signal, limits);
    if (existing === true) {
        await removeQuietly(temporary);
        return;
    }
    throwIfAborted(signal);
    await replaceFile(temporary, target);
}
async function blobMatches(target, digest, expected, signal, limits) {
    try {
        const metadata = await lstat(target);
        throwIfAborted(signal);
        if (!metadata.isFile() || metadata.size > limits.maxArtifactBytes || metadata.size !== expected.byteLength)
            return false;
        const bytes = await readFile(target, { signal });
        return bytes.byteLength === expected.byteLength && sha256(bytes) === digest;
    }
    catch (error) {
        throwIfAborted(signal, error);
        if (isMissing(error))
            return undefined;
        return false;
    }
}
async function replaceFile(source, target) {
    try {
        await rename(source, target);
    }
    catch (error) {
        if (!isReplaceRace(error))
            throw error;
        // Windows does not replace an existing file with rename. The brief absence is safe for an
        // advisory checkpoint: readers take the ordinary cold path and never see partial bytes.
        await rm(target, { force: true });
        await rename(source, target);
    }
}
async function pruneBestEffort(manifestDirectory, blobDirectory, limits, protectedDigests, protectedScope, signal) {
    try {
        throwIfAborted(signal);
        await cleanupStaleTemporaryFiles(manifestDirectory, signal);
        await cleanupStaleTemporaryFiles(blobDirectory, signal);
        await pruneManifestScopes(manifestDirectory, limits.maximumScopes, protectedScope, signal);
        const references = await referencedDigests(manifestDirectory, limits, signal);
        if (references === undefined)
            return;
        for (const digest of protectedDigests)
            references.add(digest);
        const entries = await readdir(blobDirectory, { withFileTypes: true });
        const blobs = [];
        let total = 0;
        for (const entry of entries) {
            throwIfAborted(signal);
            if (!entry.isFile() || !SHA256.test(entry.name))
                continue;
            try {
                const file = join(blobDirectory, entry.name);
                const metadata = await lstat(file);
                if (!metadata.isFile())
                    continue;
                blobs.push({ path: file, name: entry.name, bytes: metadata.size, mtimeMs: metadata.mtimeMs });
                total += metadata.size;
            }
            catch {
                // Another writer may have installed or removed this blob.
            }
        }
        if (!Number.isSafeInteger(total) || total <= limits.maxTotalBytes)
            return;
        blobs.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
        const now = Date.now();
        for (const blob of blobs) {
            if (total <= limits.maxTotalBytes)
                break;
            if (references.has(blob.name))
                continue;
            // A just-created unreferenced blob may belong to a concurrent writer whose manifest has not
            // reached its final rename yet. Leave recent files for a later best-effort prune.
            if (now - blob.mtimeMs < 60_000)
                continue;
            await removeQuietly(blob.path);
            total -= blob.bytes;
        }
    }
    catch (error) {
        if (isAbort(error))
            return;
        // Persistence is advisory. A read-only directory or a concurrent race cannot make publish fail.
    }
}
async function pruneManifestScopes(directory, maximumScopes, protectedScope, signal) {
    const entries = await readdir(directory, { withFileTypes: true });
    const manifests = [];
    for (const entry of entries) {
        throwIfAborted(signal);
        if (!entry.isFile() || !entry.name.endsWith('.json'))
            continue;
        const path = join(directory, entry.name);
        const metadata = await lstat(path);
        if (!metadata.isFile())
            continue;
        manifests.push({
            path,
            scope: entry.name.slice(0, -'.json'.length),
            mtimeMs: metadata.mtimeMs,
        });
    }
    manifests.sort((left, right) => (left.scope === protectedScope ? -1 : right.scope === protectedScope ? 1 : 0) ||
        right.mtimeMs - left.mtimeMs ||
        left.scope.localeCompare(right.scope));
    await Promise.all(manifests.slice(maximumScopes).map((manifest) => removeQuietly(manifest.path)));
}
async function referencedDigests(manifestDirectory, limits, signal) {
    let entries;
    try {
        entries = await readdir(manifestDirectory, { withFileTypes: true });
    }
    catch {
        return new Set();
    }
    const references = new Set();
    for (const entry of entries) {
        throwIfAborted(signal);
        if (!entry.isFile() || !entry.name.endsWith('.json'))
            continue;
        try {
            const file = join(manifestDirectory, entry.name);
            const metadata = await lstat(file);
            if (!metadata.isFile() || metadata.size > limits.maxManifestBytes)
                return undefined;
            const parsed = JSON.parse((await readFile(file, { signal })).toString('utf8'));
            if (!isRecord(parsed) || !Array.isArray(parsed.artifacts))
                return undefined;
            for (const descriptor of parsed.artifacts) {
                if (!isRecord(descriptor) || typeof descriptor.digest !== 'string' || !SHA256.test(descriptor.digest))
                    return undefined;
                references.add(descriptor.digest);
            }
        }
        catch (error) {
            throwIfAborted(signal, error);
            return undefined;
        }
    }
    return references;
}
async function cleanupStaleTemporaryFiles(directory, signal) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch {
        return;
    }
    const now = Date.now();
    await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
        .map(async (entry) => {
        throwIfAborted(signal);
        const file = join(directory, entry.name);
        try {
            if (now - (await lstat(file)).mtimeMs >= TEMPORARY_AGE_MS)
                await removeQuietly(file);
        }
        catch {
            // Another writer may have completed this temporary file.
        }
    }));
}
async function fsyncDirectory(directory) {
    try {
        const handle = await open(directory, constants.O_RDONLY);
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch {
        // Directory fsync is unavailable on some platforms; file fsync still protects contents.
    }
}
async function removeQuietly(file) {
    try {
        await rm(file, { force: true });
    }
    catch {
        // Advisory cleanup.
    }
}
function isMissing(error) {
    return isNodeError(error, 'ENOENT');
}
function isReplaceRace(error) {
    return isNodeError(error, 'EEXIST') || isNodeError(error, 'EPERM');
}
function isNodeError(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
//# sourceMappingURL=store.js.map
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { opendir, readFile, stat } from 'node:fs/promises';
import { join, matchesGlob, resolve } from 'node:path';
import { inventoryRepository } from '../../repository/index.js';
import { decodeWorkspaceCheckpointJson, encodeWorkspaceCheckpointJson, WORKSPACE_CHECKPOINT_JSON_ENCODING, } from '../../workspace/checkpoint/index.js';
import { TYPE_SPEC_APPLICATION_LIMITS } from '../limits.js';
const FORMAT = 'astrale.codegraph.repository-inventory-checkpoint';
const VERSION = 2;
const SCOPE = 'repository-inventory';
const INVENTORY = 'repository/inventory.json.br';
const ENTRIES = 'repository/entries.json.br';
const MAXIMUM_DECODED_ARTIFACT_BYTES = TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes;
/**
 * Reuse an exact content inventory when the filesystem proves that no ordinary write, create,
 * delete, or rename occurred. Metadata is only a preflight: any uncertainty takes the canonical
 * byte-reading inventory path.
 */
export function createCheckpointedRepositoryInventory(options) {
    const root = resolve(options.root);
    const fallback = options.inventory ?? inventoryRepository;
    let retained;
    return async (request) => {
        if (resolve(request.root) !== root || request.scanner || request.classifiers) {
            return fallback(request);
        }
        const scopeFingerprint = digestJson(request.scope ?? {});
        let metadata;
        try {
            metadata = await scanMetadata(root, '', request.scope?.exclude ?? [], request.signal);
        }
        catch {
            return fallback(request);
        }
        const metadataFingerprint = digestJson(metadata);
        let previous = retained?.repository === request.repository && retained.scope === scopeFingerprint
            ? retained
            : undefined;
        if (previous && digestJson(previous.entries.map((entry) => entry.metadata)) === metadataFingerprint) {
            return previous.inventory;
        }
        if (!previous) {
            try {
                const loaded = await options.store.load(SCOPE, signalOptions(request));
                if (loaded.ok &&
                    loaded.manifest.format === FORMAT &&
                    loaded.manifest.version === VERSION &&
                    loaded.manifest.producerFingerprint === options.producerFingerprint &&
                    isRecord(loaded.manifest.payload) &&
                    loaded.manifest.payload.repository === request.repository &&
                    loaded.manifest.payload.scope === scopeFingerprint &&
                    loaded.manifest.payload.encoding === WORKSPACE_CHECKPOINT_JSON_ENCODING) {
                    const inventoryBytes = loaded.artifacts.get(INVENTORY);
                    const entriesBytes = loaded.artifacts.get(ENTRIES);
                    if (inventoryBytes && entriesBytes) {
                        const inventoryArtifact = decodeWorkspaceCheckpointJson(inventoryBytes, {
                            maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
                        });
                        const entriesArtifact = decodeWorkspaceCheckpointJson(entriesBytes, {
                            maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
                        });
                        const decodedBytes = inventoryArtifact.decodedBytes + entriesArtifact.decodedBytes;
                        const inventory = inventoryArtifact.value;
                        const entriesValue = entriesArtifact.value;
                        if (inventory.repository === request.repository &&
                            typeof inventory.revision === 'string' &&
                            loaded.manifest.payload.inventory === inventory.revision &&
                            loaded.manifest.payload.decodedBytes === decodedBytes &&
                            Array.isArray(inventory.files) &&
                            isCachedEntries(entriesValue)) {
                            previous = {
                                repository: request.repository,
                                scope: scopeFingerprint,
                                inventory,
                                entries: entriesValue,
                            };
                            retained = previous;
                            if (loaded.manifest.payload.metadata === metadataFingerprint)
                                return inventory;
                        }
                    }
                }
            }
            catch {
                // Advisory miss: the canonical inventory below remains the sole semantic authority.
            }
        }
        let entries;
        let inventory;
        try {
            entries = await hydrateEntries(root, metadata, previous?.entries ?? [], request.signal);
            inventory = await fallback({
                ...request,
                scanner: scanner(entries),
            });
        }
        catch {
            return fallback(request);
        }
        retained = {
            repository: request.repository,
            scope: scopeFingerprint,
            inventory,
            entries,
        };
        try {
            const inventoryArtifact = encodeWorkspaceCheckpointJson(inventory, {
                maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
            });
            const entriesArtifact = encodeWorkspaceCheckpointJson(entries, {
                maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
            });
            await options.store.publish(SCOPE, {
                manifest: {
                    format: FORMAT,
                    version: VERSION,
                    producerFingerprint: options.producerFingerprint,
                    payload: {
                        repository: request.repository,
                        scope: scopeFingerprint,
                        metadata: metadataFingerprint,
                        inventory: inventory.revision,
                        encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
                        decodedBytes: inventoryArtifact.decodedBytes + entriesArtifact.decodedBytes,
                    },
                },
                artifacts: {
                    [INVENTORY]: inventoryArtifact.value,
                    [ENTRIES]: entriesArtifact.value,
                },
            }, signalOptions(request));
        }
        catch {
            // A read-only or damaged cache never changes the successful canonical result.
        }
        return inventory;
    };
}
async function hydrateEntries(root, metadata, previous, signal) {
    const before = new Map(previous.map((entry) => [entry.path, entry]));
    const entries = [];
    for (const current of metadata) {
        signal?.throwIfAborted();
        const retained = before.get(current.path);
        if (retained && sameMetadata(retained.metadata, current)) {
            entries.push(retained);
            continue;
        }
        const file = join(root, ...current.path.split('/'));
        const bytes = await readFile(file, { signal });
        const verified = await fileMetadata(current.path, file);
        if (!sameMetadata(current, verified) || bytes.byteLength !== Number(verified.bytes)) {
            throw new Error(`Repository file changed while it was being inventoried: ${current.path}`);
        }
        entries.push({
            path: current.path,
            bytes: bytes.byteLength,
            digest: createHash('sha256').update(bytes).digest('hex'),
            content: isUtf8(bytes) ? 'text' : 'binary',
            metadata: current,
        });
    }
    return entries;
}
function scanner(entries) {
    return {
        async *scan() {
            for (const { path, bytes, digest, content } of entries) {
                yield { path, bytes, digest, content };
            }
        },
    };
}
async function scanMetadata(root, relative, exclude, signal) {
    signal?.throwIfAborted();
    const directory = await opendir(relative ? join(root, relative) : root);
    const entries = [];
    for await (const entry of directory)
        entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const files = [];
    for (const entry of entries) {
        signal?.throwIfAborted();
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (path === '.git' || path.startsWith('.git/') || directoryExcluded(path, exclude))
                continue;
            files.push(...(await scanMetadata(root, path, exclude, signal)));
            continue;
        }
        if (!entry.isFile())
            continue;
        files.push(await fileMetadata(path, join(root, ...path.split('/'))));
    }
    return files;
}
async function fileMetadata(path, file) {
    const metadata = await stat(file, { bigint: true });
    return {
        path,
        device: String(metadata.dev),
        inode: String(metadata.ino),
        bytes: String(metadata.size),
        modified: String(metadata.mtimeNs),
        changed: String(metadata.ctimeNs),
    };
}
function sameMetadata(left, right) {
    return (left.path === right.path &&
        left.device === right.device &&
        left.inode === right.inode &&
        left.bytes === right.bytes &&
        left.modified === right.modified &&
        left.changed === right.changed);
}
function isCachedEntries(value) {
    return (Array.isArray(value) &&
        value.every((entry) => isRecord(entry) &&
            typeof entry.path === 'string' &&
            typeof entry.bytes === 'number' &&
            typeof entry.digest === 'string' &&
            (entry.content === 'text' || entry.content === 'binary') &&
            isRecord(entry.metadata) &&
            typeof entry.metadata.path === 'string' &&
            typeof entry.metadata.device === 'string' &&
            typeof entry.metadata.inode === 'string' &&
            typeof entry.metadata.bytes === 'string' &&
            typeof entry.metadata.modified === 'string' &&
            typeof entry.metadata.changed === 'string'));
}
function directoryExcluded(path, patterns) {
    return patterns.some((pattern) => matchesGlob(path, pattern) ||
        matchesGlob(`${path}/__entry__`, pattern) ||
        (!/[?*\[\]{}]/u.test(pattern) && (path === pattern || path.startsWith(`${pattern}/`))));
}
function digestJson(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function signalOptions(request) {
    return request.signal ? { signal: request.signal } : {};
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=inventory.js.map
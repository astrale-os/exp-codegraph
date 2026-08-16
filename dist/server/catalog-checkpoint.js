import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createFileWorkspaceCheckpointStore, } from '../workspace/checkpoint/index.js';
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.js';
const FORMAT = 'astrale.codegraph.viewer-catalog-checkpoint';
const VERSION = 1;
const CATALOG = 'viewer/catalog.json';
const CATALOG_SCOPE = 'viewer-catalog';
const VERIFICATION_SCOPE = 'viewer-verification';
const VERIFICATIONS = 'viewer/verifications.json';
/** Derived server projection cache; it has no authority over application or analysis state. */
export async function createServerCatalogCheckpoint(root) {
    const store = createFileWorkspaceCheckpointStore({
        directory: join(defaultTypeSpecCacheDirectory(), 'workspaces', createHash('sha256').update(resolve(root)).digest('hex'), 'viewer'),
        maxArtifacts: 4_096,
        maximumScopes: 4,
    });
    const producer = `@astrale-os/codegraph@${await codegraphVersion()}:viewer-catalog/1`;
    return checkpoint(store, producer);
}
function checkpoint(store, producerFingerprint) {
    let verificationDigest;
    return {
        async load(snapshot) {
            try {
                const loaded = await store.load(scope(snapshot));
                if (!loaded.ok ||
                    loaded.manifest.format !== FORMAT ||
                    loaded.manifest.version !== VERSION ||
                    loaded.manifest.producerFingerprint !== producerFingerprint ||
                    !isRecord(loaded.manifest.payload) ||
                    loaded.manifest.payload.snapshot !== snapshot)
                    return;
                const bytes = loaded.artifacts.get(CATALOG);
                if (!bytes)
                    return;
                const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
                if (!isRecord(value) || !Array.isArray(value.specs) || !Array.isArray(value.diagnostics))
                    return;
                return value;
            }
            catch {
                return;
            }
        },
        async publish(snapshot, catalog) {
            try {
                await store.publish(scope(snapshot), {
                    manifest: {
                        format: FORMAT,
                        version: VERSION,
                        producerFingerprint,
                        payload: { snapshot },
                    },
                    artifacts: { [CATALOG]: Buffer.from(JSON.stringify(catalog), 'utf8') },
                });
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
                    loaded.manifest.version !== VERSION ||
                    loaded.manifest.producerFingerprint !== producerFingerprint)
                    return [];
                const bytes = loaded.artifacts.get(VERIFICATIONS);
                if (!bytes)
                    return [];
                const values = JSON.parse(Buffer.from(bytes).toString('utf8'));
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
                const bytes = Buffer.from(JSON.stringify(values), 'utf8');
                const digest = createHash('sha256').update(bytes).digest('hex');
                if (digest === verificationDigest)
                    return;
                await store.publish(VERIFICATION_SCOPE, {
                    manifest: {
                        format: FORMAT,
                        version: VERSION,
                        producerFingerprint,
                        payload: { records: values.length },
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
}
function scope(snapshot) {
    void snapshot;
    return CATALOG_SCOPE;
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
        isRecord(value.verification) &&
        typeof value.verification.status === 'string');
}
//# sourceMappingURL=catalog-checkpoint.js.map
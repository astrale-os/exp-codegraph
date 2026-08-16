import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { selectAnalysisStore } from '../../analysis/index.js';
import { createSQLiteAnalysisStore } from '../../analysis/sqlite/index.js';
import { dispatchAnalysisTelemetry } from '../../analysis/profiling/dispatch.js';
import { createTypeSpecApplicationServiceWithDependencies } from '../service.js';
import { createApplicationCheckpoint } from '../checkpoint/index.js';
import { createFileWorkspaceCheckpointStore, } from '../../workspace/checkpoint/index.js';
import { createCheckpointedRepositoryInventory } from './inventory.js';
/** Node-owned store/native composition around the portable headless application service. */
export async function createNodeTypeSpecApplicationService(options) {
    const root = resolve(options.root);
    const maximumRetainedGenerations = options.maximumRetainedGenerations ?? 2;
    const selection = await selectAnalysisStore({
        persistence: 'advisory',
        ...((options.persistence ?? 'advisory') === 'advisory'
            ? {
                openDurable: () => createSQLiteAnalysisStore({
                    file: join(options.cacheDirectory, 'analysis-v2.sqlite'),
                    // Physical isolation belongs to the store namespace, never semantic identities.
                    namespace: `worktree:${createHash('sha256').update(root).digest('hex')}`,
                    maximumRetainedGenerations,
                    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
                }),
            }
            : {}),
    });
    const store = selection.store;
    const repository = options.repository ?? (await repositoryKey(root));
    const workspaceCheckpoint = selection.backend === 'durable'
        ? createFileWorkspaceCheckpointStore({
            directory: join(options.cacheDirectory, 'workspaces', createHash('sha256').update(root).digest('hex'), 'application'),
            maxArtifacts: 4_096,
            maximumScopes: 512,
        })
        : undefined;
    dispatchAnalysisTelemetry(options.telemetry, {
        component: 'analysis',
        phase: 'store.selection',
        metrics: {
            backend: selection.backend,
            persistence: selection.persistence,
            requestedPersistence: options.persistence ?? 'advisory',
            fallback: selection.fallback !== undefined,
            ...(selection.fallback ? { fallbackCode: selection.fallback.code } : {}),
        },
    });
    try {
        const version = await codegraphVersion();
        const application = await createTypeSpecApplicationServiceWithDependencies({
            root,
            repository,
            maximumRetainedSnapshots: options.maximumRetainedSnapshots,
            analysis: { store, maximumRetainedGenerations },
            ...(workspaceCheckpoint
                ? {
                    checkpoint: createApplicationCheckpoint({
                        store: workspaceCheckpoint,
                        producerFingerprint: `@astrale-os/codegraph@${version}:application-checkpoint/2`,
                    }),
                }
                : {}),
            ...(options.telemetry ? { telemetry: options.telemetry } : {}),
            ...(options.native ? { native: options.native } : {}),
        }, workspaceCheckpoint
            ? {
                inventory: createCheckpointedRepositoryInventory({
                    root,
                    store: workspaceCheckpoint,
                    producerFingerprint: `@astrale-os/codegraph@${version}:repository-inventory/2`,
                }),
            }
            : {});
        return ownStore(application, store, workspaceCheckpoint);
    }
    catch (error) {
        await Promise.allSettled([store.dispose(), workspaceCheckpoint?.dispose()]);
        throw error;
    }
}
function ownStore(application, store, checkpoint) {
    let disposed = false;
    return {
        refresh: (options) => application.refresh(options),
        current: () => application.current(),
        open: (snapshot) => application.open(snapshot),
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            const results = await Promise.allSettled([
                application.dispose(),
                store.dispose(),
                checkpoint?.dispose(),
            ]);
            const rejected = results.find((result) => result.status === 'rejected');
            if (rejected)
                throw rejected.reason;
        },
    };
}
async function codegraphVersion() {
    const candidate = resolve(import.meta.dirname, '..', '..');
    const packageRoot = basename(candidate) === 'dist' ? dirname(candidate) : candidate;
    const value = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (!value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof value.version !== 'string') {
        throw new Error('Installed @astrale-os/codegraph package has no version.');
    }
    return value.version;
}
async function repositoryKey(root) {
    try {
        const value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        if (value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof value.name === 'string') {
            const name = value.name.trim();
            if (name)
                return `package:${name}`;
        }
    }
    catch {
        // Anonymous source trees remain usable without leaking absolute paths into semantic identity.
    }
    return `anonymous:${basename(root) || 'repository'}`;
}
//# sourceMappingURL=service.js.map
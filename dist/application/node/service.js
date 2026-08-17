import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { selectAnalysisStore } from '../../analysis/index.js';
import { dispatchAnalysisTelemetry } from '../../analysis/profiling/dispatch.js';
import { createSQLiteAnalysisStore } from '../../analysis/sqlite/index.js';
import { createFileWorkspaceCheckpointStore, } from '../../workspace/checkpoint/index.js';
import { createApplicationCheckpoint } from '../checkpoint/index.js';
import { resolveApplicationRoot } from '../discovery/index.js';
import { createTypeSpecApplicationServiceWithDependencies } from '../service.js';
import { codegraphProducerFingerprint } from './fingerprint.js';
import { createCheckpointedRepositoryInventory, createNodeRepositoryInventory, } from './inventory.js';
/** Node-owned store/native composition around the portable headless application service. */
export async function createNodeTypeSpecApplicationService(options) {
    const root = await resolveApplicationRoot(options.root);
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
    const repository = options.repository ?? (await nodeApplicationRepositoryKey(root));
    const workspaceCheckpoint = selection.backend === 'durable'
        ? createFileWorkspaceCheckpointStore({
            directory: nodeApplicationWorkspaceCheckpointDirectory(options.cacheDirectory, root),
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
        const producer = workspaceCheckpoint ? await codegraphProducerFingerprint() : undefined;
        const application = await createTypeSpecApplicationServiceWithDependencies({
            root,
            repository,
            maximumRetainedSnapshots: options.maximumRetainedSnapshots,
            analysis: { store, maximumRetainedGenerations },
            ...(workspaceCheckpoint
                ? {
                    checkpoint: createApplicationCheckpoint({
                        store: workspaceCheckpoint,
                        producerFingerprint: `${producer}:application-checkpoint/3`,
                    }),
                }
                : {}),
            ...(options.telemetry ? { telemetry: options.telemetry } : {}),
            ...(options.native ? { native: options.native } : {}),
        }, {
            inventory: workspaceCheckpoint
                ? createCheckpointedRepositoryInventory({
                    root,
                    store: workspaceCheckpoint,
                    producerFingerprint: `${producer}:repository-inventory/3`,
                })
                : createNodeRepositoryInventory({ root }),
        });
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
export function nodeApplicationWorkspaceCheckpointDirectory(cacheDirectory, root) {
    return join(cacheDirectory, 'workspaces', createHash('sha256').update(resolve(root)).digest('hex'), 'application');
}
export async function nodeApplicationRepositoryKey(root) {
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
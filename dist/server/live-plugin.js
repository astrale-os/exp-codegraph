import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { dispatchAnalysisTelemetry } from '../analysis/profiling/dispatch.js';
import { handleSourceEditHttp } from '../application/interaction/http/editing.js';
import { SOURCE_EDIT_ENDPOINT, SOURCE_EDIT_PROTOCOL } from '../application/interaction/editing.js';
import { handleSpecRevealHttp } from '../application/interaction/http/reveal.js';
import { SPEC_REVEAL_ENDPOINT, SPEC_REVEAL_PROTOCOL } from '../application/interaction/reveal.js';
import { handleVerificationHttp } from '../application/interaction/http/qualification.js';
import { VERIFICATION_ENDPOINT, VERIFICATION_PROTOCOL } from '../application/interaction/qualification.js';
import { HISTORY_RESOURCE_ENDPOINT } from '../viewer-host/catalog.js';
import { createServerApplicationService } from './application.js';
import { projectApplicationCatalog } from './application-catalog.js';
import { revealApplicationSpecification, saveApplicationSource } from './application-operations.js';
import { handleCatalogPayloadHttp } from './catalog-http.js';
import { createCatalogSnapshot } from './catalog-snapshot.js';
import { CatalogSnapshotStore } from './catalog-store.js';
import { handleHistoryResourceHttp } from './history-http.js';
import { createRebuildScheduler, createSourceChangeFilter, } from './reload.js';
import { isWatchedSource } from './watch.js';
import { createSpecificationImpactIndex } from '../application/change/index.js';
import { createServerCatalogCheckpoint, } from './catalog-checkpoint.js';
export const CATALOG_INDEX_ID = 'virtual:spec-catalog-index';
const RESOLVED_CATALOG_INDEX_ID = `\0${CATALOG_INDEX_ID}`;
const MAX_RESIDENT_VERIFIER_APPLICATIONS = 1;
export function createLiveSpecsPlugin(options) {
    const { root, allowedRoots, verify } = options;
    const services = options.services ?? {
        ...defaultServices,
        createApplication: (applicationRoot, cache) => createServerApplicationService(applicationRoot, cache, options.native, options.telemetry),
    };
    const applicationPromise = services.createApplication(root, options.cache !== false);
    const catalogCheckpointPromise = options.services || options.cache === false
        ? Promise.resolve(undefined)
        : createServerCatalogCheckpoint(root).catch(() => undefined);
    let application;
    let reader;
    let catalog;
    let applicationSnapshot;
    let catalogGeneration = 0;
    let deliveredGeneration = 0;
    let operations = Promise.resolve();
    let initialization;
    let disposed = false;
    let viteServer;
    const pendingChanges = new Set();
    const verifiedSpecifications = new Set();
    const verifierApplications = new Map();
    const sourceChanges = createSourceChangeFilter();
    const snapshots = new CatalogSnapshotStore();
    const rebuild = async (requestedCompiler) => {
        const started = performance.now();
        const changed = [...pendingChanges].sort();
        pendingChanges.clear();
        const forceCompiler = requestedCompiler ?? verify;
        application ??= await applicationPromise;
        const refreshed = await application.refresh({
            qualify: true,
            compilerAnalysis: forceCompiler,
            ...(forceCompiler
                ? {}
                : {
                    requestedProfiles: [
                        'contract.specification.validity',
                        'contract.module.layout',
                        'contract.module.schema-catalog',
                        'contract.module.test-evidence',
                    ],
                }),
            ...(changed.length ? { changed } : {}),
        });
        const verifiedChanges = refreshed.changes.specifications.refreshed.filter((source) => verifiedSpecifications.has(source));
        const nextReader = await application.open(refreshed.snapshot.id);
        try {
            const refresh = !catalog || forceCompiler
                ? refreshed.snapshot.specifications.map((value) => value.source)
                : [
                    ...new Set([
                        ...refreshed.changes.specifications.added,
                        ...refreshed.changes.specifications.changed,
                        ...refreshed.changes.specifications.refreshed,
                    ]),
                ].sort();
            const projectionStarted = performance.now();
            dispatchAnalysisTelemetry(options.telemetry, {
                component: 'analysis',
                phase: 'application.projection',
                metrics: { status: 'started' },
            });
            const catalogCheckpoint = await catalogCheckpointPromise;
            const restoredCatalog = !catalog && changed.length === 0
                ? await catalogCheckpoint?.load(refreshed.snapshot.id)
                : undefined;
            let next = restoredCatalog ??
                (await services.projectCatalog(root, nextReader, {
                    ...(catalog ? { previous: catalog } : {}),
                    refresh,
                }));
            const verificationRecords = await catalogCheckpoint?.loadVerifications() ?? [];
            const verificationInputs = verificationInputRevisions(refreshed.snapshot);
            next = restoreVerificationRecords(next, verificationRecords, verificationInputs);
            for (const record of verificationRecords) {
                const current = next.specs.find((candidate) => candidate.source === record.source);
                if (current?.verificationRevision === record.revision) {
                    verifiedSpecifications.add(record.source);
                }
            }
            for (const source of verifiedChanges) {
                const verification = await refreshVerifiedSpecification(source, changed);
                const verified = verification?.specification;
                const current = next.specs.find((candidate) => candidate.source === source);
                if (verification?.inventory !== refreshed.snapshot.inventory ||
                    !current ||
                    !verified?.verification ||
                    current.verificationRevision !== verified.verificationRevision) {
                    continue;
                }
                next = {
                    ...next,
                    specs: next.specs.map((candidate) => candidate.source === source
                        ? { ...candidate, verification: verified.verification }
                        : candidate),
                };
            }
            const publication = snapshots.publish(createCatalogSnapshot(next, applicationAdapterManifest(refreshed.snapshot.id), refreshed.snapshot.id, snapshots.current));
            const previous = reader;
            reader = nextReader;
            catalog = next;
            applicationSnapshot = refreshed.snapshot;
            if (publication.changed)
                catalogGeneration++;
            if (!restoredCatalog)
                await catalogCheckpoint?.publish(refreshed.snapshot.id, next);
            await catalogCheckpoint?.publishVerifications(verificationRecordsFromCatalog(next, verificationInputs));
            dispatchAnalysisTelemetry(options.telemetry, {
                component: 'analysis',
                phase: 'application.projection',
                durationNs: Math.round((performance.now() - projectionStarted) * 1_000_000),
                metrics: {
                    status: 'completed',
                    specifications: restoredCatalog ? 0 : refresh.length,
                    retainedSpecifications: restoredCatalog ? next.specs.length : next.specs.length - refresh.length,
                    checkpoint: restoredCatalog !== undefined,
                },
            });
            await previous?.dispose();
            dispatchAnalysisTelemetry(options.telemetry, {
                component: 'analysis',
                phase: 'application.refresh',
                durationNs: Math.round((performance.now() - started) * 1_000_000),
                metrics: {
                    compilerAnalysis: forceCompiler,
                    changedPaths: changed.length,
                    affectedSpecifications: refreshed.changes.specifications.refreshed.length,
                    projectedSpecifications: refresh.length,
                    specifications: refreshed.snapshot.specifications.length,
                    heapUsedBytes: process.memoryUsage().heapUsed,
                    rssBytes: process.memoryUsage().rss,
                },
            });
            return { catalog: next, changed: publication.changed, generation: catalogGeneration };
        }
        catch (error) {
            await nextReader.dispose();
            throw error;
        }
    };
    const inOrder = (operation) => {
        const next = operations.then(operation, operation);
        operations = next.then(() => undefined, () => undefined);
        return next;
    };
    const rebuilds = createRebuildScheduler(() => inOrder(() => rebuild()));
    const deliver = ({ changed, generation }) => {
        if (!changed || generation <= deliveredGeneration)
            return false;
        deliveredGeneration = generation;
        return true;
    };
    const ensureCurrent = async () => {
        if (catalog && reader)
            return;
        initialization ??= inOrder(async () => {
            if (!catalog || !reader)
                await rebuild();
        }).finally(() => {
            initialization = undefined;
        });
        await initialization;
    };
    const refreshVerifiedSpecification = async (source, changed = []) => {
        let verifier = verifierApplications.get(source);
        if (!verifier) {
            while (verifierApplications.size >= MAX_RESIDENT_VERIFIER_APPLICATIONS) {
                const oldest = verifierApplications.entries().next().value;
                if (!oldest)
                    break;
                verifierApplications.delete(oldest[0]);
                await oldest[1].dispose();
            }
            verifier = await services.createApplication(root, options.cache !== false);
            verifierApplications.set(source, verifier);
        }
        else {
            verifierApplications.delete(source);
            verifierApplications.set(source, verifier);
        }
        const refreshed = await verifier.refresh({
            qualify: true,
            compilerAnalysis: true,
            focused: true,
            select: [source],
            ...(changed.length ? { changed } : {}),
        });
        const verificationReader = await verifier.open(refreshed.snapshot.id);
        try {
            const focused = await services.projectCatalog(root, verificationReader);
            return {
                specification: focused.specs.find((candidate) => candidate.source === source),
                inventory: refreshed.snapshot.inventory,
            };
        }
        finally {
            await verificationReader.dispose();
        }
    };
    const verifyInOrder = (request) => inOrder(async () => {
        await ensureCurrent();
        let specification = catalog.specs.find((candidate) => candidate.source === request.source);
        if (!specification)
            return rejected(request, 'SOURCE_NOT_FOUND', 'Specification source not found.');
        if (specification.verificationRevision !== request.revision) {
            return {
                ...rejected(request, 'SOURCE_CHANGED', 'Specification source changed.'),
                revision: specification.verificationRevision,
            };
        }
        if (specification.diagnostics.length || specification.modules.some((module) => module.diagnostics.length)) {
            return rejected(request, 'SPEC_INVALID', 'Specification validation must pass first.');
        }
        if (!specification.modules.some((module) => module.contract)) {
            return rejected(request, 'VERIFIER_MISSING', 'Specification has no API contract to verify.');
        }
        if (!specification.verification) {
            const inventory = applicationSnapshot.inventory;
            const started = performance.now();
            // Focused compiler qualification owns a separate application lifecycle. It must not move
            // the full viewer application's current snapshot or invalidate its local delta cache.
            try {
                const verification = await refreshVerifiedSpecification(request.source);
                if (verification?.inventory !== inventory) {
                    return rejected(request, 'SOURCE_CHANGED', 'Specification inventory changed.');
                }
                specification = verification.specification;
                dispatchAnalysisTelemetry(options.telemetry, {
                    component: 'analysis',
                    phase: 'application.verification',
                    durationNs: Math.round((performance.now() - started) * 1_000_000),
                    metrics: {
                        specifications: 1,
                        heapUsedBytes: process.memoryUsage().heapUsed,
                        rssBytes: process.memoryUsage().rss,
                    },
                });
            }
            catch (error) {
                const verifier = verifierApplications.get(request.source);
                verifierApplications.delete(request.source);
                await verifier?.dispose();
                throw error;
            }
            if (applicationSnapshot.inventory !== inventory || specification?.verificationRevision !== request.revision) {
                return {
                    ...rejected(request, 'SOURCE_CHANGED', 'Specification source changed.'),
                    ...(specification ? { revision: specification.verificationRevision } : {}),
                };
            }
        }
        if (!specification?.verification) {
            return rejected(request, 'EXECUTION_FAILED', 'V2 qualification did not produce a result.');
        }
        verifiedSpecifications.add(specification.source);
        const current = catalog.specs.find((candidate) => candidate.source === specification.source);
        if (current && current.verificationRevision === specification.verificationRevision) {
            const verified = { ...current, verification: specification.verification };
            catalog = {
                ...catalog,
                specs: catalog.specs.map((candidate) => candidate.source === verified.source ? verified : candidate),
            };
            const publication = snapshots.publish(createCatalogSnapshot(catalog, applicationAdapterManifest(applicationSnapshot.id), applicationSnapshot.id, snapshots.current));
            if (publication.changed)
                catalogGeneration++;
            await (await catalogCheckpointPromise)?.publish(applicationSnapshot.id, catalog);
            await (await catalogCheckpointPromise)?.publishVerifications(verificationRecordsFromCatalog(catalog, verificationInputRevisions(applicationSnapshot)));
            const module = viteServer?.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID);
            if (module)
                viteServer.moduleGraph.invalidateModule(module);
        }
        return {
            protocol: VERIFICATION_PROTOCOL,
            status: 'completed',
            source: specification.source,
            revision: specification.verificationRevision,
            verification: specification.verification,
        };
    });
    const dispose = async () => {
        if (disposed)
            return;
        disposed = true;
        await inOrder(async () => {
            await reader?.dispose();
            reader = undefined;
            const resolved = application ?? await applicationPromise;
            await Promise.all([
                resolved.dispose(),
                ...[...verifierApplications.values()].map((verifier) => verifier.dispose()),
                (await catalogCheckpointPromise)?.dispose(),
            ]);
            verifierApplications.clear();
            application = undefined;
        });
    };
    return {
        name: 'astrale-specs',
        enforce: 'pre',
        async buildStart() {
            await ensureCurrent();
        },
        async closeBundle() {
            await dispose();
        },
        resolveId(id) {
            return id === CATALOG_INDEX_ID ? RESOLVED_CATALOG_INDEX_ID : null;
        },
        async load(id) {
            if (id !== RESOLVED_CATALOG_INDEX_ID)
                return null;
            await ensureCurrent();
            return snapshots.current.indexModule;
        },
        async handleHotUpdate(context) {
            if (!isWatchedSource(applicationSnapshot, root, context.file, 'change', {
                compilerAnalysis: verify,
                compilerSpecifications: [...verifiedSpecifications],
            }))
                return;
            if (!(await sourceChanges.changed(context.file)))
                return [];
            pendingChanges.add(context.file);
            const result = await rebuilds.request();
            if (!deliver(result))
                return [];
            const module = context.server.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID);
            if (!module)
                return [];
            context.server.moduleGraph.invalidateModule(module);
            return [...new Set([module, ...context.modules])];
        },
        configureServer(vite) {
            viteServer = vite;
            vite.httpServer?.once('close', () => void dispose());
            vite.middlewares.use(async (request, response, next) => {
                try {
                    await ensureCurrent();
                    if (request.url?.startsWith(HISTORY_RESOURCE_ENDPOINT)) {
                        if (await handleHistoryResourceHttp(request, response, root, {
                            resource(source, revision) {
                                return catalog.specs
                                    .flatMap((specification) => specification.history)
                                    .find((resource) => resource.source === source && resource.revision === revision);
                            },
                        }))
                            return;
                    }
                    if (handleCatalogPayloadHttp(request, response, snapshots))
                        return;
                    if (await handleSourceEditHttp(request, response, (command, snapshot) => snapshot === reader.snapshot.id
                        ? services.editSource(root, reader, command)
                        : Promise.resolve({
                            status: 'error',
                            message: 'Application snapshot changed; reload the catalog.',
                        })))
                        return;
                    if (await handleSpecRevealHttp(request, response, (source, snapshot) => snapshot === reader.snapshot.id
                        ? services.revealSpecification(root, reader, source)
                        : Promise.resolve({
                            protocol: SPEC_REVEAL_PROTOCOL,
                            status: 'rejected',
                            code: 'SNAPSHOT_CHANGED',
                            message: 'Application snapshot changed; reload the catalog.',
                        })))
                        return;
                    if (await handleVerificationHttp(request, response, (command, snapshot) => snapshot === reader.snapshot.id
                        ? verifyInOrder(command)
                        : Promise.resolve(rejected(command, 'SOURCE_CHANGED', 'Application snapshot changed; reload the catalog.'))))
                        return;
                    next();
                }
                catch (error) {
                    next(error instanceof Error ? error : new Error(String(error)));
                }
            });
            vite.middlewares.use(async (request, response, next) => {
                if (!request.url?.startsWith('/@fs/'))
                    return next();
                try {
                    const pathname = new URL(request.url, 'http://localhost').pathname;
                    let file = decodeURIComponent(pathname.slice('/@fs/'.length));
                    if (sep === '/' && !file.startsWith('/'))
                        file = `/${file}`;
                    const target = await realpath(file);
                    if (!allowedRoots.some((allowed) => within(allowed, target)))
                        throw new Error('outside roots');
                    next();
                }
                catch {
                    response.statusCode = 403;
                    response.end('Forbidden');
                }
            });
            vite.watcher.add(root);
            const reloadTopology = (event, file) => {
                if (!isWatchedSource(applicationSnapshot, root, file, event, {
                    compilerAnalysis: verify,
                    compilerSpecifications: [...verifiedSpecifications],
                }))
                    return;
                void sourceChanges
                    .changed(file)
                    .then((changed) => {
                    if (!changed)
                        return;
                    pendingChanges.add(file);
                    return rebuilds.request();
                })
                    .then(async (result) => {
                    if (!result || !deliver(result))
                        return;
                    const module = vite.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID);
                    if (module) {
                        await vite.reloadModule(module);
                        return;
                    }
                    vite.ws.send({ type: 'full-reload' });
                })
                    .catch((error) => {
                    vite.config.logger.error(error instanceof Error ? error.message : String(error));
                });
            };
            vite.watcher.on('add', (file) => reloadTopology('add', file));
            vite.watcher.on('unlink', (file) => reloadTopology('unlink', file));
        },
    };
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function restoreVerificationRecords(catalog, records, inputs) {
    const bySource = new Map(records.map((record) => [record.source, record]));
    let changed = false;
    const specs = catalog.specs.map((specification) => {
        if (specification.verification)
            return specification;
        const record = bySource.get(specification.source);
        if (!record ||
            record.revision !== specification.verificationRevision ||
            record.inputs !== inputs.get(specification.source))
            return specification;
        changed = true;
        return { ...specification, verification: record.verification };
    });
    return changed ? { ...catalog, specs } : catalog;
}
function verificationRecordsFromCatalog(catalog, inputs) {
    return catalog.specs
        .filter((specification) => specification.verification !== undefined)
        .map((specification) => ({
        source: specification.source,
        revision: specification.verificationRevision,
        inputs: inputs.get(specification.source) ?? 'missing',
        verification: specification.verification,
    }))
        .sort((left, right) => left.source.localeCompare(right.source));
}
function verificationInputRevisions(snapshot) {
    const impact = createSpecificationImpactIndex(snapshot.specifications);
    const bySource = new Map(snapshot.specifications.map((specification) => [specification.source, []]));
    for (const file of snapshot.statistics.files) {
        for (const owner of impact.impact(file.path).refreshedOwners) {
            bySource.get(owner)?.push([file.path, file.revision]);
        }
    }
    return new Map(snapshot.specifications.map((specification) => [
        specification.source,
        createHash('sha256')
            .update(JSON.stringify([specification.id, bySource.get(specification.source) ?? []]))
            .digest('hex'),
    ]));
}
function rejected(request, code, message) {
    return {
        protocol: VERIFICATION_PROTOCOL,
        status: 'rejected',
        code,
        message,
        source: request.source,
        revision: request.revision,
    };
}
const defaultServices = {
    createApplication: createServerApplicationService,
    projectCatalog: projectApplicationCatalog,
    editSource: saveApplicationSource,
    revealSpecification: revealApplicationSpecification,
};
function applicationAdapterManifest(snapshot) {
    const endpoint = (path) => `${path}?${new URLSearchParams({ snapshot })}`;
    return {
        editing: {
            transport: 'http',
            protocol: SOURCE_EDIT_PROTOCOL,
            endpoint: endpoint(SOURCE_EDIT_ENDPOINT),
        },
        reveal: {
            transport: 'http',
            protocol: SPEC_REVEAL_PROTOCOL,
            endpoint: endpoint(SPEC_REVEAL_ENDPOINT),
        },
        verification: {
            transport: 'http',
            protocol: VERIFICATION_PROTOCOL,
            endpoint: endpoint(VERIFICATION_ENDPOINT),
        },
    };
}
//# sourceMappingURL=live-plugin.js.map
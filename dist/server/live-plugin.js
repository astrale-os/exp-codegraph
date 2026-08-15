import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
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
export const CATALOG_INDEX_ID = 'virtual:spec-catalog-index';
const RESOLVED_CATALOG_INDEX_ID = `\0${CATALOG_INDEX_ID}`;
export function createLiveSpecsPlugin(options) {
    const { root, allowedRoots, verify } = options;
    const services = options.services ?? {
        ...defaultServices,
        createApplication: (applicationRoot, cache) => createServerApplicationService(applicationRoot, cache, options.native),
    };
    const applicationPromise = services.createApplication(root, options.cache !== false);
    let application;
    let reader;
    let catalog;
    let applicationSnapshot;
    let catalogGeneration = 0;
    let deliveredGeneration = 0;
    let compilerAnalysis = verify;
    let operations = Promise.resolve();
    let disposed = false;
    const pendingChanges = new Set();
    const sourceChanges = createSourceChangeFilter();
    const snapshots = new CatalogSnapshotStore();
    const rebuild = async (forceCompiler = compilerAnalysis) => {
        const changed = [...pendingChanges].sort();
        pendingChanges.clear();
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
        if (forceCompiler)
            compilerAnalysis = true;
        const nextReader = await application.open(refreshed.snapshot.id);
        try {
            const next = await services.projectCatalog(root, nextReader);
            const publication = snapshots.publish(createCatalogSnapshot(next, applicationAdapterManifest(refreshed.snapshot.id), refreshed.snapshot.id));
            const previous = reader;
            reader = nextReader;
            catalog = next;
            applicationSnapshot = refreshed.snapshot;
            if (publication.changed)
                catalogGeneration++;
            await previous?.dispose();
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
        if (!catalog || !reader)
            await rebuild();
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
            await rebuild(true);
            specification = catalog.specs.find((candidate) => candidate.source === request.source);
            if (applicationSnapshot.inventory !== inventory ||
                specification?.verificationRevision !== request.revision) {
                return {
                    ...rejected(request, 'SOURCE_CHANGED', 'Specification source changed.'),
                    ...(specification ? { revision: specification.verificationRevision } : {}),
                };
            }
        }
        if (!specification?.verification) {
            return rejected(request, 'EXECUTION_FAILED', 'V2 qualification did not produce a result.');
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
            await resolved.dispose();
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
            if (!isWatchedSource(applicationSnapshot, root, context.file, 'change'))
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
                if (!isWatchedSource(applicationSnapshot, root, file, event))
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
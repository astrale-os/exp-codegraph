import { createMemoryAnalysisStore } from '../../analysis/index.js';
import { createTypeScriptAnalysisService, TYPESCRIPT_MODULE_FACT_NAMESPACE, } from '../../analysis/typescript/index.js';
import { resolveApplicationModuleBoundaries } from './boundary.js';
import { observeCompilerProject } from './workspace-observability.js';
import { dispatchAnalysisTelemetry } from '../../analysis/profiling/dispatch.js';
import { ApplicationCompilerRoutingIndex, groupApplicationCompilerProjects, mapApplicationCompilerProjects, } from './workspace.optimization.js';
import { materializeApplicationObservations } from '../observation/index.js';
/** Compose resident ttsc project sessions into one immutable, generation-pinned repository view. */
export function createApplicationAnalysisWorkspace(options) {
    return new ResidentApplicationAnalysisWorkspace(options);
}
class ResidentApplicationAnalysisWorkspace {
    #store;
    #ownsStore;
    #services = new Map();
    #routing = new ApplicationCompilerRoutingIndex();
    #projectUniverses = new Map();
    #boundaryDigest = '';
    #adoptedGenerations = new Map();
    #disposed = false;
    #options;
    constructor(options) {
        this.#options = options;
        this.#store =
            options.store ??
                createMemoryAnalysisStore({
                    maximumRetainedGenerations: options.maximumRetainedGenerations ?? 2,
                    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
                });
        this.#ownsStore = options.store === undefined;
    }
    async refresh(options) {
        this.assertOpen();
        options.signal?.throwIfAborted();
        const resolution = options.compilerAnalysis === false && options.moduleBindings !== true
            ? { boundaries: [], diagnostics: [] }
            : await resolveApplicationModuleBoundaries(this.#options.root, options.specifications);
        const byProject = options.compilerAnalysis === false
            ? new Map()
            : groupApplicationCompilerProjects(resolution.boundaries);
        const projects = [...byProject];
        const digest = JSON.stringify([...byProject]);
        const boundaryChanged = options.compilerAnalysis !== false && digest !== this.#boundaryDigest;
        const compatibleResidentBoundary = options.compilerAnalysis === false || digest === this.#boundaryDigest;
        if (boundaryChanged) {
            await this.disposeServices();
            this.#routing.reset();
            this.#projectUniverses.clear();
            this.#boundaryDigest = digest;
        }
        const retainedProjects = this.#routing.retained(projects, options.residentModules);
        let refreshProjects = [...this.#routing.affected(projects, options.changes, boundaryChanged || options.invalidate === true || this.#adoptedGenerations.size === 0)];
        if (this.#services.size &&
            refreshProjects.some(([project]) => !this.#services.has(project))) {
            await this.disposeServices();
            const refreshNames = new Set(refreshProjects.map(([project]) => project));
            refreshProjects = [
                ...refreshProjects,
                ...projects.filter(([project]) => retainedProjects.has(project) && !refreshNames.has(project)),
            ];
        }
        refreshProjects = refreshProjects
            .sort(([left], [right]) => Number(retainedProjects.has(left)) - Number(retainedProjects.has(right)) ||
            left.localeCompare(right));
        const refreshedProjects = await mapApplicationCompilerProjects(refreshProjects, async ([project, modules]) => {
            options.signal?.throwIfAborted();
            let service = this.#services.get(project);
            if (!service) {
                service = await createTypeScriptAnalysisService({
                    project: {
                        root: this.#options.root,
                        config: project,
                        capabilities: [TYPESCRIPT_MODULE_FACT_NAMESPACE],
                        modules,
                    },
                    sessions: this.#options.sessions,
                    store: this.#store,
                    ...(this.#projectUniverses.get(project)
                        ? { universe: this.#projectUniverses.get(project) }
                        : {}),
                    ...(this.#options.telemetry ? { telemetry: this.#options.telemetry } : {}),
                });
                this.#services.set(project, service);
            }
            try {
                const result = await observeCompilerProject(this.#options.telemetry, project, () => service.refresh({
                    ...(options.changed ? { changed: options.changed } : {}),
                    ...(options.changes ? { changes: options.changes } : {}),
                    ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                }));
                this.#routing.update(project, result.moduleRouting);
                this.#projectUniverses.set(project, result.generation.universe);
                if (!retainedProjects.has(project)) {
                    this.#services.delete(project);
                    await service.dispose();
                }
                return { project, result };
            }
            catch (error) {
                this.#services.delete(project);
                await service.dispose().catch(() => undefined);
                throw error;
            }
        });
        for (const [project, service] of [...this.#services]) {
            if (retainedProjects.has(project))
                continue;
            this.#services.delete(project);
            await service.dispose();
        }
        const results = [...refreshedProjects]
            .sort((left, right) => left.project.localeCompare(right.project))
            .map(({ result }) => result);
        const generations = new Map(compatibleResidentBoundary
            ? this.#adoptedGenerations
            : []);
        for (const [universe, generation] of results.map((result) => [result.generation.universe, result.generation.id])) {
            generations.set(universe, generation);
        }
        const bindingAffectedModules = options.moduleBindings === true
            ? affectedBindingModules(resolution.boundaries, options.changes ?? [])
            : [];
        const specificationSourceByModule = new Map((options.observationSpecifications ?? options.specifications)
            .map((specification) => [specification.module.id, specification.source]));
        const observationRefresh = [
            ...new Set([
                ...(options.refreshSpecifications ?? []),
                ...bindingAffectedModules.flatMap((module) => {
                    const source = specificationSourceByModule.get(module);
                    return source ? [source] : [];
                }),
            ]),
        ].sort();
        const observation = await materializeApplicationObservations({
            root: this.#options.root,
            store: this.#store,
            inventory: options.inventory,
            specifications: options.observationSpecifications ?? options.specifications,
            ...(options.moduleBindings === true ? { bindings: resolution.boundaries } : {}),
            ...(observationRefresh.length
                ? { refresh: observationRefresh }
                : {}),
            ...(options.schemaDependencies
                ? { schemaDependencies: options.schemaDependencies }
                : {}),
            ...(options.signal ? { signal: options.signal } : {}),
        });
        if (observation.bindingWork) {
            dispatchAnalysisTelemetry(this.#options.telemetry, {
                component: 'analysis',
                phase: 'application.module-bindings',
                durationNs: Math.round(observation.bindingWork.durationMs * 1_000_000),
                metrics: { status: 'completed', ...observation.bindingWork },
            });
        }
        generations.set(observation.universe, observation.generation.id);
        const snapshot = await this.#store.snapshotSet(generations, options.inventory.revision);
        const affectedModules = compatibleResidentBoundary &&
            results.every((result) => result.changedModules !== undefined)
            ? [...new Set([
                    ...results.flatMap((result) => result.changedModules ?? []),
                    ...bindingAffectedModules,
                ])].sort()
            : undefined;
        this.#adoptedGenerations = new Map(generations);
        return {
            snapshot,
            universes: snapshot.universes,
            boundaries: resolution.boundaries,
            results,
            observation,
            ...(affectedModules ? { affectedModules } : {}),
            diagnostics: [
                ...resolution.diagnostics.map((diagnostic) => `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`),
                ...results.flatMap((result) => result.diagnostics),
            ],
        };
    }
    async open(generations, inventory) {
        this.assertOpen();
        const snapshot = await this.#store.snapshotSet(generations, inventory);
        this.#adoptedGenerations = new Map(generations);
        return snapshot;
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#adoptedGenerations.clear();
        this.#projectUniverses.clear();
        await this.disposeServices();
        if (this.#ownsStore)
            await this.#store.dispose();
    }
    async disposeServices() {
        const services = [...this.#services.values()];
        this.#services.clear();
        const results = await Promise.allSettled(services.map((service) => service.dispose()));
        const rejected = results.find((result) => result.status === 'rejected');
        if (rejected)
            throw rejected.reason;
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('Application analysis workspace is disposed.');
    }
}
function affectedBindingModules(boundaries, changes) {
    if (changes.some((change) => change.kind === 'unknown')) {
        return boundaries.map((boundary) => boundary.id).sort();
    }
    return boundaries
        .filter((boundary) => changes.some((change) => change.path === boundary.project ||
        change.path === boundary.entrypoint ||
        change.path === boundary.root ||
        change.path.startsWith(`${boundary.root}/`)))
        .map((boundary) => boundary.id)
        .sort();
}
//# sourceMappingURL=workspace.js.map
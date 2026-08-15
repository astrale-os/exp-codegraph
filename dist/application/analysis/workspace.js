import { createMemoryAnalysisStore } from '../../analysis/index.js';
import { createTypeScriptAnalysisService, TYPESCRIPT_MODULE_FACT_NAMESPACE, } from '../../analysis/typescript/index.js';
import { resolveApplicationModuleBoundaries } from './boundary.js';
import { materializeApplicationObservations } from '../observation/index.js';
/** Compose resident ttsc project sessions into one immutable, generation-pinned repository view. */
export function createApplicationAnalysisWorkspace(options) {
    return new ResidentApplicationAnalysisWorkspace(options);
}
class ResidentApplicationAnalysisWorkspace {
    #store;
    #ownsStore;
    #services = new Map();
    #boundaryDigest = '';
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
        const resolution = options.compilerAnalysis === false
            ? { boundaries: [], diagnostics: [] }
            : await resolveApplicationModuleBoundaries(this.#options.root, options.specifications);
        const byProject = groupByProject(resolution.boundaries);
        const digest = JSON.stringify([...byProject]);
        if (options.compilerAnalysis !== false && digest !== this.#boundaryDigest) {
            await this.disposeServices();
            for (const [project, modules] of byProject) {
                this.#services.set(project, await createTypeScriptAnalysisService({
                    project: {
                        root: this.#options.root,
                        config: project,
                        capabilities: [TYPESCRIPT_MODULE_FACT_NAMESPACE],
                        modules,
                    },
                    sessions: this.#options.sessions,
                    store: this.#store,
                    ...(this.#options.telemetry ? { telemetry: this.#options.telemetry } : {}),
                }));
            }
            this.#boundaryDigest = digest;
        }
        const results = [];
        for (const [project] of byProject) {
            options.signal?.throwIfAborted();
            const service = this.#services.get(project);
            if (!service)
                throw new Error(`Application analysis service is missing for ${project}.`);
            results.push(await service.refresh({
                ...(options.changed ? { changed: options.changed } : {}),
                ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
            }));
        }
        const generations = new Map(results.map((result) => [result.generation.universe, result.generation.id]));
        const observation = await materializeApplicationObservations({
            root: this.#options.root,
            store: this.#store,
            inventory: options.inventory,
            specifications: options.specifications,
            ...(options.schemaDependencies
                ? { schemaDependencies: options.schemaDependencies }
                : {}),
            ...(options.signal ? { signal: options.signal } : {}),
        });
        generations.set(observation.universe, observation.generation.id);
        const snapshot = await this.#store.snapshotSet(generations, options.inventory.revision);
        return {
            snapshot,
            universes: snapshot.universes,
            boundaries: resolution.boundaries,
            results,
            observation,
            diagnostics: [
                ...resolution.diagnostics.map((diagnostic) => `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`),
                ...results.flatMap((result) => result.diagnostics),
            ],
        };
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
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
function groupByProject(boundaries) {
    const values = new Map();
    for (const boundary of boundaries) {
        const current = values.get(boundary.project) ?? [];
        current.push(boundary);
        values.set(boundary.project, current);
    }
    return new Map([...values]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([project, current]) => [
        project,
        current.sort((left, right) => left.id.localeCompare(right.id)),
    ]));
}
//# sourceMappingURL=workspace.js.map
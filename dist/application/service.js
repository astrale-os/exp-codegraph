import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { withOperationSnapshot } from '../source/operation-snapshot.js';
import { APPLICATION_REPOSITORY_EXCLUDES, discoverSpecificationDirectories, resolveApplicationRoot, } from './discovery/index.js';
import { MODULE_LAYOUT_PROFILE_ID, createModuleLayoutConformanceProfile, createTypeSpecConformanceProfiles, qualifySpecifications, } from '../conformance/index.js';
import { analyzeRepositoryStatistics, createRepositoryPathOwnershipGrouping, createRepositorySourceService, defaultRepositoryStatisticsGroupings, inventoryRepository, } from '../repository/index.js';
import { compileSpecificationSnapshots } from '../specification/index.js';
import { deriveAnalysisId } from '../analysis/index.js';
import { createApplicationAnalysisWorkspace, createCodegraphApplicationSessionFactory, } from './analysis/index.js';
import { assertSpecificationInventory, createApplicationSnapshot } from './snapshot/index.js';
import { selectApplicationSpecifications } from './selection/index.js';
import { applicationSchemaDependencies } from './observation/index.js';
import { TYPE_SPEC_APPLICATION_LIMITS } from './limits.js';
/** Assemble specification, exact analysis, and qualification without coupling them to a UI. */
export async function createTypeSpecApplicationService(options) {
    return createTypeSpecApplicationServiceWithDependencies(options);
}
/** Internal injection seam used by qualification; ordinary consumers receive the governed defaults. */
export async function createTypeSpecApplicationServiceWithDependencies(options, injected = {}) {
    const root = await (injected.resolveRoot ?? resolveApplicationRoot)(options.root);
    const repository = await repositoryIdentity(root, options.repository);
    const analysis = injected.analysis ??
        createApplicationAnalysisWorkspace({
            root,
            repository,
            sessions: createCodegraphApplicationSessionFactory({
                ...options.native,
                ...(options.telemetry ? { telemetry: options.telemetry } : {}),
            }),
            ...(options.telemetry ? { telemetry: options.telemetry } : {}),
            ...options.analysis,
        });
    return new HeadlessTypeSpecApplicationService(root, repository, {
        resolveRoot: injected.resolveRoot ?? resolveApplicationRoot,
        discover: injected.discover ?? discoverSpecificationDirectories,
        compile: injected.compile ?? compileSpecificationSnapshots,
        inventory: injected.inventory ?? inventoryRepository,
        sources: injected.sources ?? createRepositorySourceService,
        statistics: injected.statistics ?? analyzeRepositoryStatistics,
        analysis,
        profiles: injected.profiles ?? createTypeSpecConformanceProfiles(),
    }, options.maximumRetainedSnapshots ?? TYPE_SPEC_APPLICATION_LIMITS.maximumRetainedSnapshots);
}
async function repositoryIdentity(root, explicit) {
    let key = explicit;
    if (!key) {
        try {
            const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
            if (typeof manifest.name === 'string' && manifest.name.trim())
                key = `package:${manifest.name}`;
        }
        catch {
            // The explicit diagnostic below is more useful than leaking an absolute checkout path.
        }
    }
    if (!key?.trim()) {
        throw new Error('A portable repository key is required when the root package.json has no non-empty name.');
    }
    return deriveAnalysisId('repository', 'astrale.typespec.application', { key });
}
class HeadlessTypeSpecApplicationService {
    #disposed = false;
    #current;
    #currentRequestKey;
    #corpus;
    #records = new Map();
    #root;
    #repository;
    #dependencies;
    #maximumRetainedSnapshots;
    constructor(root, repository, dependencies, maximumRetainedSnapshots) {
        this.#root = root;
        this.#repository = repository;
        this.#dependencies = dependencies;
        this.#maximumRetainedSnapshots = maximumRetainedSnapshots;
        if (!Number.isSafeInteger(maximumRetainedSnapshots) || maximumRetainedSnapshots < 1) {
            throw new Error('maximumRetainedSnapshots must be a positive safe integer.');
        }
    }
    async refresh(options = {}) {
        return withOperationSnapshot(() => this.refreshSnapshot(options));
    }
    async refreshSnapshot(options) {
        this.assertOpen();
        const started = performance.now();
        let phase = started;
        options.signal?.throwIfAborted();
        const inventory = await this.#dependencies.inventory({
            repository: this.#repository,
            root: this.#root,
            scope: { exclude: APPLICATION_REPOSITORY_EXCLUDES },
            ...(options.signal ? { signal: options.signal } : {}),
        });
        const inventoryMs = performance.now() - phase;
        const previous = this.current();
        const requestKey = applicationRefreshKey(options);
        if (previous &&
            previous.inventory === inventory.revision &&
            this.#currentRequestKey === requestKey &&
            (options.schemaRoots?.length ?? 0) === 0 &&
            (options.changed?.length ?? 0) === 0 &&
            options.invalidate !== true) {
            return {
                snapshot: previous,
                changes: applicationChanges(previous, previous, [], []),
                timing: {
                    totalMs: performance.now() - started,
                    discoverMs: 0,
                    compileMs: 0,
                    inventoryMs,
                    statisticsMs: 0,
                    analysisMs: 0,
                    qualificationMs: 0,
                },
            };
        }
        const corpusKey = applicationCorpusKey(inventory.revision, options.exclude ?? []);
        const discoveryKey = applicationDiscoveryKey(options.exclude ?? []);
        let specifications;
        let sources;
        let statistics;
        let discoverMs = 0;
        let compileMs = 0;
        let statisticsMs = 0;
        const cachedCorpus = this.#corpus;
        if (cachedCorpus?.key === corpusKey) {
            specifications = cachedCorpus.specifications;
            sources = cachedCorpus.sources;
            statistics = cachedCorpus.statistics;
        }
        else {
            phase = performance.now();
            const directories = await this.#dependencies.discover(this.#root, {
                ...(options.exclude ? { exclude: options.exclude } : {}),
            });
            discoverMs = performance.now() - phase;
            phase = performance.now();
            specifications =
                cachedCorpus?.discoveryKey === discoveryKey && (options.changed?.length ?? 0) > 0
                    ? await refreshSpecificationCorpus(this.#root, directories, cachedCorpus.specifications, options.changed ?? [], this.#dependencies.compile)
                    : [
                        ...(await this.#dependencies.compile(this.#root, directories, {
                            maximumConcurrency: TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
                        })),
                    ];
            compileMs = performance.now() - phase;
            assertSpecificationInventory(specifications, inventory);
            phase = performance.now();
            sources = this.#dependencies.sources(this.#root, inventory);
            statistics = await this.#dependencies.statistics({
                inventory,
                sources,
                groupings: [
                    ...defaultRepositoryStatisticsGroupings(),
                    createRepositoryPathOwnershipGrouping('module', specifications.map((specification) => ({
                        root: specification.root,
                        key: specification.module.id,
                        label: specification.title,
                    }))),
                ],
                ...(options.signal ? { signal: options.signal } : {}),
            });
            statisticsMs = performance.now() - phase;
            this.#corpus = { key: corpusKey, discoveryKey, specifications, sources, statistics };
        }
        const selected = selectApplicationSpecifications(this.#root, specifications, {
            ...(options.select ? { select: options.select } : {}),
            ...(options.focused !== undefined ? { focused: options.focused } : {}),
            ...(options.includeDependents !== undefined
                ? { includeDependents: options.includeDependents }
                : {}),
        });
        const analysisSpecifications = options.focused ? selected.qualification : specifications;
        let schemaDependencies = [];
        if (options.schemaRoots?.length) {
            phase = performance.now();
            schemaDependencies = await this.loadSchemaDependencies(options.schemaRoots);
            compileMs += performance.now() - phase;
        }
        options.signal?.throwIfAborted();
        let qualifications = [];
        let analysis;
        let analysisDiagnostics = [];
        let observationDiagnostics = [];
        let analysisSnapshot;
        let changedSources = [];
        let invalidatedPasses = [];
        let analysisMs = 0;
        let qualificationMs = 0;
        if (options.qualify) {
            phase = performance.now();
            const refreshed = await this.#dependencies.analysis.refresh({
                specifications: analysisSpecifications,
                inventory,
                ...(schemaDependencies.length ? { schemaDependencies } : {}),
                ...(options.compilerAnalysis !== undefined
                    ? { compilerAnalysis: options.compilerAnalysis }
                    : {}),
                ...(options.changed ? { changed: options.changed } : {}),
                ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
            });
            analysisMs = performance.now() - phase;
            analysisSnapshot = refreshed.snapshot;
            observationDiagnostics = refreshed.observation?.diagnostics ?? [];
            changedSources = sortedUnique(refreshed.results.flatMap((result) => result.changedSources));
            invalidatedPasses = sortedUnique(refreshed.results.flatMap((result) => result.invalidatedPasses));
            try {
                phase = performance.now();
                const profiles = applicationProfiles(this.#dependencies.profiles, options);
                qualifications = await qualifySpecifications({
                    specifications: selected.qualification,
                    analysis: refreshed.snapshot,
                    profiles,
                    ...(options.requestedProfiles
                        ? { requestedProfiles: options.requestedProfiles }
                        : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                });
                analysis = {
                    id: refreshed.snapshot.id,
                    inventory: refreshed.snapshot.inventory,
                    universes: refreshed.snapshot.universes,
                };
                analysisDiagnostics = refreshed.diagnostics;
                qualificationMs = performance.now() - phase;
            }
            catch (error) {
                await refreshed.snapshot.dispose();
                throw error;
            }
        }
        const candidate = createApplicationSnapshot({
            repository: this.#repository,
            inventory: inventory.revision,
            selection: selected.selection,
            specifications: selected.included,
            statistics,
            qualifications,
            ...(analysis ? { analysis } : {}),
            diagnostics: [
                ...(specifications.length
                    ? []
                    : [
                        {
                            code: 'SPEC_NOT_FOUND',
                            message: 'No .spec/api.d.ts anchors found.',
                            file: '.',
                            line: 1,
                            column: 1,
                        },
                    ]),
                ...selected.diagnostics,
                ...observationDiagnostics,
                ...selected.qualification.flatMap((specification) => specification.diagnostics),
            ],
            analysisDiagnostics,
        });
        const snapshot = await this.publish(candidate, sources, analysisSnapshot);
        this.#currentRequestKey = requestKey;
        return {
            snapshot,
            changes: applicationChanges(previous, snapshot, changedSources, invalidatedPasses),
            timing: {
                totalMs: performance.now() - started,
                discoverMs,
                compileMs,
                inventoryMs,
                statisticsMs,
                analysisMs,
                qualificationMs,
            },
        };
    }
    async loadSchemaDependencies(inputs) {
        const roots = [];
        for (const input of inputs) {
            const root = await this.#dependencies.resolveRoot(input);
            if (root !== this.#root && !roots.includes(root))
                roots.push(root);
        }
        const resources = [];
        for (const [ordinal, root] of roots.entries()) {
            const directories = await this.#dependencies.discover(root);
            const specifications = await this.#dependencies.compile(root, directories, {
                maximumConcurrency: TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
            });
            resources.push(...applicationSchemaDependencies(ordinal, specifications.flatMap((specification) => specification.schemas)));
        }
        return resources;
    }
    current() {
        if (!this.#current)
            return;
        return this.#records.get(this.#current)?.snapshot;
    }
    async open(snapshot = this.#current) {
        this.assertOpen();
        if (!snapshot)
            throw new Error('No TypeSpec application snapshot has been published.');
        const record = this.#records.get(snapshot);
        if (!record)
            throw new Error(`TypeSpec application snapshot is not retained: ${snapshot}`);
        record.readers += 1;
        let disposed = false;
        const assertReader = () => {
            if (disposed || record.disposed)
                throw new Error('TypeSpec application reader is disposed.');
        };
        return {
            snapshot: record.snapshot,
            async query(universe) {
                assertReader();
                if (!record.analysis) {
                    throw new Error('This application snapshot has no analysis generations.');
                }
                return record.analysis.query(universe);
            },
            async source(request) {
                assertReader();
                return record.sources.read(request);
            },
            async dispose() {
                if (disposed)
                    return;
                disposed = true;
                record.readers -= 1;
                if (!record.retained && record.readers === 0)
                    await disposeRecord(record);
            },
        };
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#current = undefined;
        this.#currentRequestKey = undefined;
        this.#corpus = undefined;
        const records = [...this.#records.values()];
        this.#records.clear();
        await Promise.all(records.map(disposeRecord));
        await this.#dependencies.analysis.dispose();
    }
    async publish(snapshot, sources, analysis) {
        const existing = this.#records.get(snapshot.id);
        if (existing) {
            if (analysis)
                await analysis.dispose();
            this.#records.delete(snapshot.id);
            this.#records.set(snapshot.id, existing);
            this.#current = snapshot.id;
            return existing.snapshot;
        }
        const record = {
            snapshot,
            analysis,
            sources,
            readers: 0,
            retained: true,
            disposed: false,
        };
        this.#records.set(snapshot.id, record);
        this.#current = snapshot.id;
        while (this.#records.size > this.#maximumRetainedSnapshots) {
            const oldest = this.#records.entries().next().value;
            if (!oldest)
                break;
            this.#records.delete(oldest[0]);
            oldest[1].retained = false;
            if (oldest[1].readers === 0)
                await disposeRecord(oldest[1]);
        }
        return snapshot;
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('TypeSpec application service is disposed.');
    }
}
async function disposeRecord(record) {
    if (record.disposed)
        return;
    record.disposed = true;
    await record.analysis?.dispose();
}
function applicationChanges(previous, current, sources, invalidatedPasses) {
    const before = new Map(previous?.specifications.map((value) => [value.source, value]) ?? []);
    const after = new Map(current.specifications.map((value) => [value.source, value]));
    return {
        ...(previous ? { previous: previous.id } : {}),
        specifications: {
            added: [...after.keys()].filter((source) => !before.has(source)).sort(),
            changed: [...after]
                .filter(([source, value]) => {
                const old = before.get(source);
                return old !== undefined && old.id !== value.id;
            })
                .map(([source]) => source)
                .sort(),
            removed: [...before.keys()].filter((source) => !after.has(source)).sort(),
        },
        sources: sortedUnique(sources),
        invalidatedPasses: sortedUnique(invalidatedPasses),
    };
}
function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
/**
 * Normalize only semantic refresh inputs. Inventory identity independently pins every local byte;
 * explicit invalidation/change hints and external schema roots deliberately bypass the fast path.
 */
function applicationRefreshKey(options) {
    return JSON.stringify({
        exclude: sortedUnique(options.exclude ?? []),
        select: sortedUnique(options.select ?? []),
        focused: options.focused === true,
        includeDependents: options.includeDependents === true,
        requireCompleteLayout: options.requireCompleteLayout === true,
        requireExactLayout: options.requireExactLayout === true,
        requestedProfiles: sortedUnique(options.requestedProfiles ?? []),
        compilerAnalysis: options.compilerAnalysis !== false,
        qualify: options.qualify === true,
    });
}
function applicationCorpusKey(inventory, exclude) {
    return JSON.stringify({ inventory, exclude: sortedUnique(exclude) });
}
function applicationDiscoveryKey(exclude) {
    return JSON.stringify({ exclude: sortedUnique(exclude) });
}
async function refreshSpecificationCorpus(root, directories, previous, changed, compile) {
    const available = new Map(directories.map((directory) => [portable(relative(root, resolve(directory))), resolve(directory)]));
    const retained = new Map(previous.map((specification) => [
        portable(relative(root, dirname(resolve(root, specification.source)))),
        specification,
    ]));
    const affected = new Set();
    for (const directory of available.keys()) {
        if (!retained.has(directory))
            affected.add(directory);
    }
    for (const input of changed) {
        const source = await workspacePath(root, input);
        if (!source)
            continue;
        if (source === '.spec/api.d.ts' ||
            source.endsWith('/.spec/api.d.ts') ||
            (source.endsWith('.d.ts') && !source.startsWith('.spec/') && !source.includes('/.spec/'))) {
            // Public declarations can affect any importing specification. Until the normative compiler
            // exposes an exact reverse-dependency closure, retaining a dependent snapshot is unsound.
            for (const directory of available.keys())
                affected.add(directory);
            continue;
        }
        const owner = specificationDirectory(source);
        if (owner && available.has(owner))
            affected.add(owner);
        for (const [directory, specification] of retained) {
            if (!available.has(directory))
                continue;
            if (normativeSpecificationSources(specification).has(source) ||
                packageManifestAffects(source, specification.root))
                affected.add(directory);
        }
    }
    const compiled = affected.size
        ? await compile(root, [...affected].map((directory) => available.get(directory)).filter(Boolean), {
            maximumConcurrency: TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
        })
        : [];
    const replacements = new Map(compiled.map((specification) => [
        portable(relative(root, dirname(resolve(root, specification.source)))),
        specification,
    ]));
    return [...available.keys()]
        .map((directory) => replacements.get(directory) ?? retained.get(directory))
        .filter((value) => value !== undefined)
        .sort((left, right) => left.source.localeCompare(right.source));
}
function normativeSpecificationSources(specification) {
    const resources = [
        ...(specification.module.api ? [specification.module.api] : []),
        ...(specification.module.code ? [specification.module.code] : []),
        ...(specification.module.internal ? [specification.module.internal] : []),
        ...specification.module.ports,
        ...specification.schemas,
        ...specification.examples,
        ...specification.capabilities,
        ...specification.flows,
        ...specification.laws,
        ...specification.states,
        ...(specification.limits ? [specification.limits] : []),
        ...(specification.layout ? [specification.layout] : []),
        ...specification.benchmarks,
        ...specification.packages,
        ...specification.packagePatterns,
    ];
    return new Set([
        specification.module.packageAuthority.source,
        ...resources.flatMap((resource) => [
            resource.source,
            ...('model' in resource && resource.model
                ? [
                    ...resource.model.sources.map((candidate) => candidate.file),
                    ...(resource.model.dependencies ?? []).map((candidate) => candidate.file),
                ]
                : []),
        ]),
    ]);
}
function packageManifestAffects(source, moduleRoot) {
    if (!source.endsWith('/package.json') && source !== 'package.json')
        return false;
    const packageRoot = source === 'package.json' ? '.' : source.slice(0, -'/package.json'.length);
    return packageRoot === '.' || moduleRoot === packageRoot || moduleRoot.startsWith(`${packageRoot}/`);
}
function specificationDirectory(source) {
    const marker = source.indexOf('/.spec/');
    if (marker >= 0)
        return `${source.slice(0, marker)}/.spec`;
    return source.startsWith('.spec/') ? '.spec' : undefined;
}
async function workspacePath(root, input) {
    let target = resolve(root, input);
    try {
        target = await realpath(target);
    }
    catch {
        try {
            target = join(await realpath(dirname(target)), basename(target));
        }
        catch {
            return;
        }
    }
    const path = relative(root, target);
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
        return;
    return portable(path);
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function applicationProfiles(profiles, options) {
    if (!options.requireCompleteLayout && !options.requireExactLayout)
        return profiles;
    const layout = createModuleLayoutConformanceProfile({
        requireComplete: Boolean(options.requireCompleteLayout || options.requireExactLayout),
        requireExact: Boolean(options.requireExactLayout),
    });
    const replaced = profiles.map((profile) => profile.manifest.id === MODULE_LAYOUT_PROFILE_ID ? layout : profile);
    return replaced.some((profile) => profile.manifest.id === MODULE_LAYOUT_PROFILE_ID)
        ? replaced
        : [...replaced, layout];
}
//# sourceMappingURL=service.js.map
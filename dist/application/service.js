import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checkpointGenerations } from './checkpoint/index.js';
import { withOperationSnapshot } from '../source/operation-snapshot.js';
import { APPLICATION_REPOSITORY_EXCLUDES, discoverSpecificationDirectories, resolveApplicationRoot, } from './discovery/index.js';
import { MODULE_LAYOUT_PROFILE_ID, createModuleLayoutConformanceProfile, createTypeSpecConformanceProfiles, planConformance, qualifySpecifications, rebindQualificationSnapshot, } from '../conformance/index.js';
import { createRepositoryPathOwnershipGrouping, createRepositorySourceService, defaultRepositoryStatisticsGroupings, inventoryRepository, refreshRepositoryStatistics, } from '../repository/index.js';
import { compileSpecificationSnapshots } from '../specification/index.js';
import { deriveAnalysisId } from '../analysis/index.js';
import { dispatchAnalysisTelemetry } from '../analysis/profiling/dispatch.js';
import { createApplicationAnalysisWorkspace, createCodegraphApplicationSessionFactory, } from './analysis/index.js';
import { assertSpecificationInventory, createApplicationSnapshot } from './snapshot/index.js';
import { selectApplicationSpecifications } from './selection/index.js';
import { applicationSchemaDependencies } from './observation/index.js';
import { TYPE_SPEC_APPLICATION_LIMITS } from './limits.js';
const ADVISORY_CHECKPOINT_DELAY_MS = 250;
import { createSpecificationImpactIndex } from './change/index.js';
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
        statistics: injected.statistics ?? refreshRepositoryStatistics,
        analysis,
        profiles: injected.profiles ?? createTypeSpecConformanceProfiles(),
        ...(injected.checkpoint ?? options.checkpoint
            ? { checkpoint: injected.checkpoint ?? options.checkpoint }
            : {}),
    }, options.maximumRetainedSnapshots ?? TYPE_SPEC_APPLICATION_LIMITS.maximumRetainedSnapshots, options.telemetry);
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
    #pendingCheckpoint;
    #checkpointWriter;
    #records = new Map();
    #root;
    #repository;
    #dependencies;
    #maximumRetainedSnapshots;
    #telemetry;
    constructor(root, repository, dependencies, maximumRetainedSnapshots, telemetry) {
        this.#root = root;
        this.#repository = repository;
        this.#dependencies = dependencies;
        this.#maximumRetainedSnapshots = maximumRetainedSnapshots;
        this.#telemetry = telemetry;
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
        this.phaseStarted('application.inventory');
        const inventory = await this.#dependencies.inventory({
            repository: this.#repository,
            root: this.#root,
            scope: { exclude: APPLICATION_REPOSITORY_EXCLUDES },
            ...(options.signal ? { signal: options.signal } : {}),
        });
        const inventoryMs = performance.now() - phase;
        this.phaseCompleted('application.inventory', inventoryMs);
        const previous = this.current();
        const requestKey = applicationRefreshKey(options);
        let checkpointMs = 0;
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
                    checkpointMs,
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
        if (!previous && this.#dependencies.checkpoint && checkpointLoadEligible(options)) {
            phase = performance.now();
            this.phaseStarted('application.checkpoint');
            const loaded = await this.#dependencies.checkpoint.load({
                repository: this.#repository,
                inventory: inventory.revision,
                request: requestKey,
                ...(options.signal ? { signal: options.signal } : {}),
            });
            checkpointMs = performance.now() - phase;
            if (loaded.ok) {
                let restoredAnalysis;
                try {
                    assertSpecificationInventory(loaded.content.specifications, inventory);
                    if (loaded.content.snapshot.analysis) {
                        restoredAnalysis = await this.#dependencies.analysis.open(checkpointGenerations(loaded.content.snapshot), inventory.revision);
                        if (restoredAnalysis.id !== loaded.content.snapshot.analysis.id) {
                            throw new Error('Checkpoint analysis snapshot identity does not match its generations.');
                        }
                    }
                    const restoredSources = this.#dependencies.sources(this.#root, inventory);
                    this.#corpus = {
                        key: corpusKey,
                        discoveryKey,
                        specifications: loaded.content.specifications,
                        inventory: loaded.content.inventory,
                        sources: restoredSources,
                        statistics: loaded.content.statistics,
                    };
                    const snapshot = await this.publish(loaded.content.snapshot, restoredSources, restoredAnalysis);
                    this.#currentRequestKey = requestKey;
                    this.phaseCompleted('application.checkpoint', checkpointMs, {
                        outcome: 'hit',
                        specifications: loaded.content.specifications.length,
                    });
                    return {
                        snapshot,
                        changes: applicationChanges(undefined, snapshot, [], []),
                        timing: {
                            totalMs: performance.now() - started,
                            checkpointMs,
                            discoverMs: 0,
                            compileMs: 0,
                            inventoryMs,
                            statisticsMs: 0,
                            analysisMs: 0,
                            qualificationMs: 0,
                        },
                    };
                }
                catch {
                    await restoredAnalysis?.dispose();
                }
            }
            this.phaseCompleted('application.checkpoint', checkpointMs, {
                outcome: 'miss',
                reason: loaded.ok ? 'generation-unavailable' : loaded.reason,
            });
        }
        let specifications;
        let sources;
        let statistics;
        let discoverMs = 0;
        let compileMs = 0;
        let statisticsMs = 0;
        let compiledSpecifications = 0;
        let refreshedSpecificationSources = [];
        let statisticsWork = {
            reusedFiles: [],
            analyzedFiles: [],
            removedFiles: [],
        };
        const cachedCorpus = this.#corpus;
        if (cachedCorpus?.key === corpusKey) {
            specifications = cachedCorpus.specifications;
            sources = cachedCorpus.sources;
            statistics = cachedCorpus.statistics;
        }
        else {
            phase = performance.now();
            this.phaseStarted('application.discovery');
            const directories = await this.#dependencies.discover(this.#root, {
                ...(options.exclude ? { exclude: options.exclude } : {}),
            });
            discoverMs = performance.now() - phase;
            this.phaseCompleted('application.discovery', discoverMs, { specifications: directories.length });
            phase = performance.now();
            this.phaseStarted('application.compile');
            const inventoryChanges = cachedCorpus
                ? repositoryInventoryChanges(cachedCorpus.inventory, inventory)
                : [];
            if (cachedCorpus?.discoveryKey === discoveryKey && inventoryChanges.length > 0) {
                const refreshedCorpus = await refreshSpecificationCorpus(this.#root, directories, cachedCorpus.specifications, inventoryChanges, options.changed ?? [], this.#dependencies.compile);
                specifications = refreshedCorpus.specifications;
                refreshedSpecificationSources = refreshedCorpus.refreshedOwners;
                compiledSpecifications = refreshedCorpus.compiled;
            }
            else {
                specifications = [
                    ...(await this.#dependencies.compile(this.#root, directories, {
                        maximumConcurrency: TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
                    })),
                ];
                refreshedSpecificationSources = specifications.map((value) => value.source);
                compiledSpecifications = specifications.length;
            }
            compileMs = performance.now() - phase;
            this.phaseCompleted('application.compile', compileMs, {
                specifications: compiledSpecifications,
                retainedSpecifications: specifications.length - compiledSpecifications,
            });
            assertSpecificationInventory(specifications, inventory);
            phase = performance.now();
            this.phaseStarted('application.statistics');
            sources = this.#dependencies.sources(this.#root, inventory);
            const refreshedStatistics = await this.#dependencies.statistics({
                inventory,
                sources,
                ...(cachedCorpus ? { previous: cachedCorpus.statistics } : {}),
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
            statistics = refreshedStatistics.report;
            statisticsWork = refreshedStatistics.work;
            statisticsMs = performance.now() - phase;
            this.phaseCompleted('application.statistics', statisticsMs, {
                analyzedFiles: statisticsWork.analyzedFiles.length,
                reusedFiles: statisticsWork.reusedFiles.length,
                removedFiles: statisticsWork.removedFiles.length,
            });
            this.#corpus = { key: corpusKey, discoveryKey, specifications, inventory, sources, statistics };
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
            this.phaseStarted('application.analysis');
            const refreshed = await this.#dependencies.analysis.refresh({
                specifications: analysisSpecifications,
                observationSpecifications: specifications,
                refreshSpecifications: schemaDependencies.length
                    ? analysisSpecifications.map((value) => value.source)
                    : refreshedSpecificationSources,
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
            this.phaseCompleted('application.analysis', analysisMs);
            analysisSnapshot = refreshed.snapshot;
            observationDiagnostics = refreshed.observation?.diagnostics ?? [];
            changedSources = sortedUnique(refreshed.results.flatMap((result) => result.changedSources));
            invalidatedPasses = sortedUnique(refreshed.results.flatMap((result) => result.invalidatedPasses));
            try {
                phase = performance.now();
                this.phaseStarted('application.qualification');
                const profiles = applicationProfiles(this.#dependencies.profiles, options);
                const plan = planConformance(profiles, options.requestedProfiles);
                const localReuse = previous !== undefined &&
                    this.#currentRequestKey === requestKey &&
                    plan.ordered.every((profile) => profile.manifest.evaluationScope === 'specification');
                const refreshedOwners = new Set(refreshedSpecificationSources);
                const previousBySource = new Map((localReuse ? previous.qualifications : []).map((value) => [
                    value.specification.source,
                    value,
                ]));
                const evaluatedSpecifications = selected.qualification.filter((specification) => {
                    const prior = previousBySource.get(specification.source);
                    return !prior || prior.specification.id !== specification.id || refreshedOwners.has(specification.source);
                });
                const evaluated = await qualifySpecifications({
                    specifications: evaluatedSpecifications,
                    analysis: refreshed.snapshot,
                    profiles,
                    ...(options.requestedProfiles
                        ? { requestedProfiles: options.requestedProfiles }
                        : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                });
                const evaluatedBySource = new Map(evaluated.map((value) => [value.specification.source, value]));
                qualifications = selected.qualification.map((specification) => {
                    const fresh = evaluatedBySource.get(specification.source);
                    if (fresh)
                        return fresh;
                    const prior = previousBySource.get(specification.source);
                    if (!prior)
                        throw new Error(`Qualification result is missing for ${specification.source}.`);
                    return rebindQualificationSnapshot(prior, specification, refreshed.snapshot);
                });
                analysis = {
                    id: refreshed.snapshot.id,
                    inventory: refreshed.snapshot.inventory,
                    universes: refreshed.snapshot.universes,
                    generations: [...refreshed.snapshot.generations]
                        .map(([universe, generation]) => ({ universe, generation }))
                        .sort((left, right) => left.universe.localeCompare(right.universe)),
                };
                analysisDiagnostics = refreshed.diagnostics;
                qualificationMs = performance.now() - phase;
                this.phaseCompleted('application.qualification', qualificationMs, {
                    specifications: evaluatedSpecifications.length,
                    reusedSpecifications: qualifications.length - evaluatedSpecifications.length,
                });
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
        if (this.#dependencies.checkpoint && checkpointPublishEligible(options)) {
            this.scheduleCheckpoint({
                repository: this.#repository,
                inventory: inventory.revision,
                request: requestKey,
            }, { snapshot, specifications, inventory, statistics });
        }
        return {
            snapshot,
            changes: applicationChanges(previous, snapshot, changedSources, invalidatedPasses, refreshedSpecificationSources),
            timing: {
                totalMs: performance.now() - started,
                checkpointMs,
                discoverMs,
                compileMs,
                inventoryMs,
                statisticsMs,
                analysisMs,
                qualificationMs,
            },
        };
    }
    phaseStarted(phase) {
        dispatchAnalysisTelemetry(this.#telemetry, {
            component: 'analysis',
            phase,
            metrics: { status: 'started' },
        });
    }
    phaseCompleted(phase, durationMs, metrics = {}) {
        dispatchAnalysisTelemetry(this.#telemetry, {
            component: 'analysis',
            phase,
            durationNs: Math.round(durationMs * 1_000_000),
            metrics: { status: 'completed', ...metrics },
        });
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
        await this.#checkpointWriter;
        await Promise.all(records.map(disposeRecord));
        await this.#dependencies.analysis.dispose();
    }
    scheduleCheckpoint(expectation, content) {
        if (!this.#dependencies.checkpoint)
            return;
        this.#pendingCheckpoint = { expectation, content };
        if (this.#checkpointWriter)
            return;
        this.#checkpointWriter = (async () => {
            // Publishing is advisory. Start it in a later task so synchronous packing cannot extend the
            // refresh/HMR critical path; dispose still drains the writer before releasing its stores.
            await new Promise((resolve) => setTimeout(resolve, ADVISORY_CHECKPOINT_DELAY_MS));
            while (this.#pendingCheckpoint) {
                const pending = this.#pendingCheckpoint;
                this.#pendingCheckpoint = undefined;
                const started = performance.now();
                this.phaseStarted('application.checkpoint');
                try {
                    await this.#dependencies.checkpoint.publish(pending.expectation, pending.content);
                    this.phaseCompleted('application.checkpoint', performance.now() - started, {
                        outcome: 'published',
                    });
                }
                catch (error) {
                    this.phaseCompleted('application.checkpoint', performance.now() - started, {
                        outcome: 'unavailable',
                        error: error instanceof Error ? error.name : 'unknown',
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        })().finally(() => {
            this.#checkpointWriter = undefined;
        });
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
function applicationChanges(previous, current, sources, invalidatedPasses, refreshedSpecifications = []) {
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
            refreshed: sortedUnique(refreshedSpecifications),
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
function checkpointLoadEligible(options) {
    return (checkpointPublishEligible(options) &&
        (options.changed?.length ?? 0) === 0 &&
        options.invalidate !== true);
}
function checkpointPublishEligible(options) {
    return options.invalidate !== true && (options.schemaRoots?.length ?? 0) === 0;
}
function applicationCorpusKey(inventory, exclude) {
    return JSON.stringify({ inventory, exclude: sortedUnique(exclude) });
}
function applicationDiscoveryKey(exclude) {
    return JSON.stringify({ exclude: sortedUnique(exclude) });
}
async function refreshSpecificationCorpus(root, directories, previous, inventoryChanges, changedHints, compile) {
    const available = new Map(directories.map((directory) => [portable(relative(root, resolve(directory))), resolve(directory)]));
    const retained = new Map(previous.map((specification) => [
        portable(relative(root, dirname(resolve(root, specification.source)))),
        specification,
    ]));
    const index = createSpecificationImpactIndex(previous);
    const impactedOwners = new Set();
    const compilationOwners = new Set();
    const specificationsBySource = new Map(previous.map((value) => [value.source, value]));
    const affected = new Set();
    for (const directory of available.keys()) {
        if (!retained.has(directory))
            affected.add(directory);
    }
    const changes = new Map(inventoryChanges.map((change) => [change.path, change.kind]));
    for (const input of changedHints) {
        const source = await workspacePath(root, input);
        if (!source)
            continue;
        if (!changes.has(source))
            changes.set(source, 'change');
    }
    for (const [source, kind] of changes) {
        const impact = index.impact(source, { kind });
        const fallback = requiresNormativeFallback(source, kind, impact.fallbackReasons);
        const normative = fallback || impact.directOwners.some((owner) => specificationsBySource.get(owner) &&
            normativeSpecificationInputs(specificationsBySource.get(owner)).has(source));
        const refreshedOwners = normative
            ? impact.refreshedOwners
            : deepestSpecificationOwners(impact.directOwners, specificationsBySource);
        for (const owner of refreshedOwners) {
            impactedOwners.add(owner);
            if (normative)
                compilationOwners.add(owner);
        }
    }
    for (const owner of compilationOwners) {
        const directory = portable(relative(root, dirname(resolve(root, owner))));
        if (available.has(directory))
            affected.add(directory);
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
    const specifications = [...available.keys()]
        .map((directory) => replacements.get(directory) ?? retained.get(directory))
        .filter((value) => value !== undefined)
        .sort((left, right) => left.source.localeCompare(right.source));
    return {
        specifications,
        refreshedOwners: sortedUnique([
            ...impactedOwners,
            ...compiled.map((value) => value.source),
        ]),
        compiled: compiled.length,
    };
}
function deepestSpecificationOwners(owners, specifications) {
    const depth = Math.max(...owners.map((owner) => specifications.get(owner)?.root.split('/').length ?? -1), -1);
    return owners.filter((owner) => (specifications.get(owner)?.root.split('/').length ?? -1) === depth);
}
function normativeSpecificationInputs(specification) {
    const inputs = new Set();
    const add = (resource) => {
        if (!resource)
            return;
        inputs.add(resource.source);
        for (const source of resource.model?.sources ?? [])
            inputs.add(source.file);
        for (const dependency of resource.model?.dependencies ?? [])
            inputs.add(dependency.file);
    };
    add(specification.module.api);
    add(specification.module.code);
    add(specification.module.internal);
    for (const resource of specification.module.ports)
        add(resource);
    for (const resource of [
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
        ...specification.module.packageAuthority.packages,
        ...specification.module.packageAuthority.packagePatterns,
    ])
        add(resource);
    inputs.add(specification.module.packageAuthority.source);
    for (const reference of specification.sourceReferences) {
        inputs.add(reference.source);
        inputs.add(reference.target.source);
    }
    return inputs;
}
function requiresNormativeFallback(source, kind, reasons) {
    if (reasons.includes('unknown-declaration') ||
        reasons.includes('package-configuration') ||
        reasons.includes('typescript-configuration'))
        return true;
    if (kind === 'change')
        return false;
    if (!(source.startsWith('.spec/') || source.includes('/.spec/')))
        return false;
    return !source.endsWith('/architecture.md') && !source.endsWith('/icon.svg');
}
function repositoryInventoryChanges(previous, current) {
    const before = new Map(previous.files.map((file) => [file.path, file.revision]));
    const after = new Map(current.files.map((file) => [file.path, file.revision]));
    return sortedUnique([...before.keys(), ...after.keys()]).flatMap((path) => {
        const left = before.get(path);
        const right = after.get(path);
        if (left === right)
            return [];
        return [{ path, kind: left === undefined ? 'add' : right === undefined ? 'unlink' : 'change' }];
    });
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
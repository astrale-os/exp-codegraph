import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import type {
  AnalysisSnapshotSet,
  AnalysisTelemetrySink,
  PassId,
  RepositoryId,
  SourceId,
} from '../analysis/index.ts'
import type { ConformanceProfile, QualificationSnapshot } from '../conformance/index.ts'
import type {
  RepositorySourceService,
  RepositoryInventory,
  RepositoryStatisticsRefreshWork,
  RepositoryStatisticsReport,
} from '../repository/index.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type {
  SpecificationCompilationPhase,
  SpecificationSnapshot,
} from '../specification/index.ts'
import type { ApplicationAnalysisWorkspace } from './analysis/index.ts'
import type {
  ApplicationCheckpoint,
  ApplicationCheckpointContent,
  ApplicationCheckpointExpectation,
} from './checkpoint/index.ts'
import type {
  TypeSpecApplicationChanges,
  TypeSpecApplicationCapability,
  TypeSpecApplicationCheckpointPublication,
  TypeSpecApplicationReader,
  TypeSpecApplicationRefresh,
  TypeSpecApplicationRefreshOptions,
  TypeSpecApplicationService,
  TypeSpecApplicationSettlement,
  TypeSpecApplicationSnapshot,
  TypeSpecApplicationSnapshotId,
} from './model.ts'
import type { ApplicationSchemaDependencyResource } from './observation/index.ts'

import { deriveAnalysisId } from '../analysis/index.ts'
import { dispatchAnalysisTelemetry } from '../analysis/profiling/dispatch.ts'
import {
  MODULE_LAYOUT_PROFILE_ID,
  createModuleLayoutConformanceProfile,
  createTypeSpecConformanceProfiles,
  planConformance,
  qualifySpecifications,
  rebindQualificationSnapshot,
} from '../conformance/index.ts'
import {
  createRepositoryPathOwnershipGrouping,
  createRepositorySourceService,
  defaultRepositoryStatisticsGroupings,
  inventoryRepository,
  refreshRepositoryStatistics,
} from '../repository/index.ts'
import { withOperationSnapshot } from '../source/operation-snapshot.ts'
import { compileSpecificationSnapshots } from '../specification/index.ts'
import {
  createApplicationAnalysisWorkspace,
  createCodegraphApplicationSessionFactory,
  type ApplicationAnalysisWorkspaceOptions,
  type CodegraphApplicationSessionOptions,
} from './analysis/index.ts'
import { applicationCheckpointCorpus, checkpointGenerations } from './checkpoint/index.ts'
import {
  applicationRepositoryExcludes,
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from './discovery/index.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from './limits.ts'
import { applicationSchemaDependencies } from './observation/index.ts'
import {
  applicationSpecificationAnchors,
  normalizeApplicationSelectionTargets,
  selectApplicationSpecifications,
} from './selection/index.ts'
import { compileRequestedSpecificationClosure } from './selection/closure.ts'
import { assertSpecificationInventory, createApplicationSnapshot } from './snapshot/index.ts'

import {
  canRetainPartialSpecificationCorpus,
  refreshSpecificationCorpus,
  repositoryInventoryChanges,
} from './change/refresh.ts'

export interface TypeSpecApplicationDependencies {
  readonly resolveRoot: (input: string) => Promise<string>
  readonly discover: typeof discoverSpecificationDirectories
  readonly compile: typeof compileSpecificationSnapshots
  readonly inventory: typeof inventoryRepository
  readonly sources: typeof createRepositorySourceService
  readonly statistics: typeof refreshRepositoryStatistics
  readonly analysis: ApplicationAnalysisWorkspace
  readonly profiles: readonly ConformanceProfile[]
  readonly checkpoint?: ApplicationCheckpoint
}

export interface TypeSpecApplicationOptions {
  readonly root: string
  /** Portable repository key; required when the root package has no stable package name. */
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly telemetry?: AnalysisTelemetrySink
  readonly analysis?: Omit<ApplicationAnalysisWorkspaceOptions, 'root' | 'repository' | 'sessions'>
  readonly native?: CodegraphApplicationSessionOptions
  /** Optional advisory process-independent application checkpoint. */
  readonly checkpoint?: ApplicationCheckpoint
}

/** Assemble specification, exact analysis, and qualification without coupling them to a UI. */
export async function createTypeSpecApplicationService(
  options: TypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService> {
  return createTypeSpecApplicationServiceWithDependencies(options)
}

/** Internal injection seam used by qualification; ordinary consumers receive the governed defaults. */
export async function createTypeSpecApplicationServiceWithDependencies(
  options: TypeSpecApplicationOptions,
  injected: Partial<TypeSpecApplicationDependencies> = {},
): Promise<TypeSpecApplicationService> {
  const root = await (injected.resolveRoot ?? resolveApplicationRoot)(options.root)
  assertApplicationRoot(root)
  const repository = await resolveApplicationRepositoryIdentity(root, options.repository)
  const analysis =
    injected.analysis ??
    createApplicationAnalysisWorkspace({
      root,
      repository,
      sessions: createCodegraphApplicationSessionFactory({
        ...options.native,
        ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      }),
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      ...options.analysis,
    })
  return new HeadlessTypeSpecApplicationService(
    root,
    repository,
    {
      resolveRoot: injected.resolveRoot ?? resolveApplicationRoot,
      discover: injected.discover ?? discoverSpecificationDirectories,
      compile: observedSpecificationCompiler(
        injected.compile ?? compileSpecificationSnapshots,
        options.telemetry,
      ),
      inventory: injected.inventory ?? inventoryRepository,
      sources: injected.sources ?? createRepositorySourceService,
      statistics: injected.statistics ?? refreshRepositoryStatistics,
      analysis,
      profiles: injected.profiles ?? createTypeSpecConformanceProfiles(),
      ...((injected.checkpoint ?? options.checkpoint)
        ? { checkpoint: injected.checkpoint ?? options.checkpoint }
        : {}),
    },
    options.maximumRetainedSnapshots ?? TYPE_SPEC_APPLICATION_LIMITS.maximumRetainedSnapshots,
    options.telemetry,
  )
}

export async function resolveApplicationRepositoryIdentity(
  root: string,
  explicit?: string,
): Promise<RepositoryId> {
  let key = explicit
  if (!key) {
    try {
      const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
        readonly name?: unknown
      }
      if (typeof manifest.name === 'string' && manifest.name.trim())
        key = `package:${manifest.name}`
    } catch {
      // The explicit diagnostic below is more useful than leaking an absolute checkout path.
    }
  }
  if (!key?.trim()) {
    throw new Error(
      'A portable repository key is required when the root package.json has no non-empty name.',
    )
  }
  return deriveAnalysisId('repository', 'astrale.typespec.application', { key }) as RepositoryId
}

class HeadlessTypeSpecApplicationService implements TypeSpecApplicationService {
  #disposed = false
  #current: TypeSpecApplicationSnapshotId | undefined
  #currentRequestKey: string | undefined
  #corpus: ApplicationCorpus | undefined
  #pendingCheckpoint:
    | {
        readonly expectation: ApplicationCheckpointExpectation
        readonly content: ApplicationCheckpointContent
      }
    | undefined
  #checkpointWriter: Promise<void> | undefined
  #checkpointPublication: TypeSpecApplicationCheckpointPublication | undefined
  readonly #records = new Map<TypeSpecApplicationSnapshotId, ApplicationRecord>()
  readonly #root: string
  readonly #repository: RepositoryId
  readonly #dependencies: TypeSpecApplicationDependencies
  readonly #maximumRetainedSnapshots: number
  readonly #telemetry: AnalysisTelemetrySink | undefined

  constructor(
    root: string,
    repository: RepositoryId,
    dependencies: TypeSpecApplicationDependencies,
    maximumRetainedSnapshots: number,
    telemetry: AnalysisTelemetrySink | undefined,
  ) {
    this.#root = root
    this.#repository = repository
    this.#dependencies = dependencies
    this.#maximumRetainedSnapshots = maximumRetainedSnapshots
    this.#telemetry = telemetry
    if (!Number.isSafeInteger(maximumRetainedSnapshots) || maximumRetainedSnapshots < 1) {
      throw new Error('maximumRetainedSnapshots must be a positive safe integer.')
    }
  }

  async refresh(
    options: TypeSpecApplicationRefreshOptions = {},
  ): Promise<TypeSpecApplicationRefresh> {
    return withOperationSnapshot(() => this.refreshSnapshot(options))
  }

  private async refreshSnapshot(
    options: TypeSpecApplicationRefreshOptions,
  ): Promise<TypeSpecApplicationRefresh> {
    this.assertOpen()
    const started = performance.now()
    let phase = started
    const capabilities = applicationCapabilities(options.requestedCapabilities)
    if (
      options.qualify === true &&
      options.compilerAnalysis !== false &&
      !capabilities.includes('declaration-models')
    ) {
      throw new TypeError('Compiler analysis requires the declaration-models capability.')
    }
    const statisticsRequested = capabilities.includes('repository-statistics')
    const compile = specificationCompilerForCapabilities(
      this.#dependencies.compile,
      capabilities,
    )
    options.signal?.throwIfAborted()
    this.phaseStarted('application.inventory')
    const inventory = await this.#dependencies.inventory({
      repository: this.#repository,
      root: this.#root,
      scope: { exclude: applicationRepositoryExcludes(this.#root, options.exclude ?? []) },
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const inventoryMs = performance.now() - phase
    this.phaseCompleted('application.inventory', inventoryMs)
    let previous = this.current()
    const requestKey = applicationRefreshKey(options)
    let checkpointMs = 0
    if (
      previous &&
      previous.inventory === inventory.revision &&
      this.#currentRequestKey === requestKey &&
      (options.schemaRoots?.length ?? 0) === 0 &&
      (options.changed?.length ?? 0) === 0 &&
      options.invalidate !== true
    ) {
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
      }
    }
    const corpusKey = applicationCorpusKey(
      inventory.revision,
      options.exclude ?? [],
      capabilities,
    )
    const discoveryKey = applicationCheckpointCorpus(options.exclude ?? [])
    if (!previous && this.#dependencies.checkpoint && checkpointLoadEligible(options)) {
      phase = performance.now()
      this.phaseStarted('application.checkpoint')
      const checkpointExpectation = {
        repository: this.#repository,
        inventory: inventory.revision,
        corpus: discoveryKey,
        request: requestKey,
        ...applicationCheckpointProjection(this.#root, options, capabilities),
        ...(options.signal ? { signal: options.signal } : {}),
      }
      const loaded = await this.#dependencies.checkpoint.load(checkpointExpectation)
      checkpointMs = performance.now() - phase
      let restoredCorpus = false
      let restoreError: { readonly name: string; readonly message: string } | undefined
      if (loaded.ok) {
        let restoredAnalysis: AnalysisSnapshotSet | undefined
        try {
          const restoredInventory = loaded.content.inventory.revision === inventory.revision
            ? inventory
            : loaded.content.inventory
          assertSpecificationInventory(loaded.content.specifications, restoredInventory)
          const restoredSources = this.#dependencies.sources(this.#root, restoredInventory)
          const corpus: ApplicationCorpus = {
            key: applicationCorpusKey(
              restoredInventory.revision,
              options.exclude ?? [],
              capabilities,
            ),
            discoveryKey,
            specifications: loaded.content.specifications,
            inventory: restoredInventory,
            sources: restoredSources,
            statistics: loaded.content.statistics,
            complete: loaded.content.complete,
            ...(loaded.content.complete ? {} : { request: requestKey }),
          }
          if (!loaded.exact) {
            this.#corpus = corpus
            restoredCorpus = true
            previous = loaded.content.snapshot
            this.phaseCompleted('application.checkpoint', checkpointMs, {
              outcome: 'corpus-hit',
              specifications: loaded.content.specifications.length,
              checkpointProjection: loaded.work.projection,
              checkpointArtifacts: loaded.work.artifacts,
              checkpointDecodedBytes: loaded.work.decodedBytes,
              checkpointApiPayloads: loaded.work.apiPayloads,
              inventoryChanged: loaded.content.inventory.revision !== inventory.revision,
            })
          } else {
            if (!loaded.content.snapshot) {
              throw new Error('Exact application checkpoint omitted its snapshot.')
            }
            assertSpecificationInventory(loaded.content.specifications, inventory)
            if (loaded.content.snapshot.analysis) {
              restoredAnalysis = await this.#dependencies.analysis.open(
                checkpointGenerations(loaded.content.snapshot),
                inventory.revision,
              )
              if (restoredAnalysis.id !== loaded.content.snapshot.analysis.id) {
                throw new Error(
                  'Checkpoint analysis snapshot identity does not match its generations.',
                )
              }
            }
            const snapshot = await this.publish(
              loaded.content.snapshot,
              restoredSources,
              restoredAnalysis,
            )
            this.#corpus = corpus
            restoredCorpus = true
            this.#currentRequestKey = requestKey
            if (loaded.migration) {
              this.scheduleCheckpoint(checkpointExpectation, {
                ...loaded.content,
                snapshot: loaded.content.snapshot,
              })
            }
            this.phaseCompleted('application.checkpoint', checkpointMs, {
              outcome: 'hit',
              specifications: loaded.content.specifications.length,
              checkpointProjection: loaded.work.projection,
              checkpointArtifacts: loaded.work.artifacts,
              checkpointDecodedBytes: loaded.work.decodedBytes,
              checkpointApiPayloads: loaded.work.apiPayloads,
            })
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
            }
          }
        } catch (error) {
          this.#corpus = undefined
          await restoredAnalysis?.dispose()
          restoreError = {
            name: error instanceof Error ? error.name : 'unknown',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
      if (!restoredCorpus) {
        this.phaseCompleted('application.checkpoint', checkpointMs, {
          outcome: 'miss',
          reason: loaded.ok ? 'restore-rejected' : loaded.reason,
          ...(restoreError ? { error: restoreError.name, detail: restoreError.message } : {}),
        })
      }
    }
    let specifications: readonly SpecificationSnapshot[]
    let sources: RepositorySourceService
    let statistics: RepositoryStatisticsReport | undefined
    let discoverMs = 0
    let compileMs = 0
    let statisticsMs = 0
    let compiledSpecifications = 0
    let completeCorpus = true
    const retainedCorpus = this.#corpus
    const cachedCorpus = retainedCorpus &&
      (retainedCorpus.complete || retainedCorpus.request === requestKey)
      ? retainedCorpus
      : undefined
    completeCorpus = cachedCorpus?.complete ?? true
    const inventoryChanges = cachedCorpus
      ? repositoryInventoryChanges(cachedCorpus.inventory, inventory)
      : []
    let discoveredSpecificationCount = cachedCorpus?.specifications.length ?? 0
    let refreshedSpecificationSources: readonly string[] = []
    let statisticsWork: RepositoryStatisticsRefreshWork = {
      reusedFiles: [],
      analyzedFiles: [],
      removedFiles: [],
    }
    if (cachedCorpus?.key === corpusKey) {
      specifications = cachedCorpus.specifications
      sources = cachedCorpus.sources
      statistics = statisticsRequested ? cachedCorpus.statistics : undefined
      if (statisticsRequested && !statistics) {
        phase = performance.now()
        this.phaseStarted('application.statistics')
        const refreshedStatistics = await this.#dependencies.statistics({
          inventory,
          sources,
          groupings: [
            ...defaultRepositoryStatisticsGroupings(),
            createRepositoryPathOwnershipGrouping(
              'module',
              specifications.map((specification) => ({
                root: specification.root,
                key: specification.module.id,
                label: specification.title,
              })),
            ),
          ],
          ...(options.signal ? { signal: options.signal } : {}),
        })
        statistics = refreshedStatistics.report
        statisticsWork = refreshedStatistics.work
        statisticsMs = performance.now() - phase
        this.phaseCompleted('application.statistics', statisticsMs, {
          analyzedFiles: statisticsWork.analyzedFiles.length,
          reusedFiles: statisticsWork.reusedFiles.length,
          removedFiles: statisticsWork.removedFiles.length,
        })
        this.#corpus = { ...cachedCorpus, statistics }
      }
    } else {
      phase = performance.now()
      this.phaseStarted('application.discovery')
      const directories = await this.#dependencies.discover(this.#root, {
        exclude: applicationRepositoryExcludes(this.#root, options.exclude ?? []),
      })
      discoverMs = performance.now() - phase
      discoveredSpecificationCount = directories.length
      const anchors = applicationSpecificationAnchors(this.#root, directories)
      sources = this.#dependencies.sources(this.#root, inventory)
      this.phaseCompleted('application.discovery', discoverMs, {
        specifications: directories.length,
      })
      phase = performance.now()
      this.phaseStarted('application.compile')
      if (cachedCorpus?.discoveryKey === discoveryKey && inventoryChanges.length > 0) {
        const refreshDirectories =
          !cachedCorpus.complete &&
          canRetainPartialSpecificationCorpus(cachedCorpus.specifications, inventoryChanges)
            ? cachedCorpus.specifications.map((specification) =>
                resolve(this.#root, specification.root, '.spec'),
              )
            : directories
        const refreshedCorpus = await refreshSpecificationCorpus(
          this.#root,
          refreshDirectories,
          cachedCorpus.specifications,
          inventoryChanges,
          options.changed ?? [],
          compile,
        )
        specifications = refreshedCorpus.specifications
        refreshedSpecificationSources = refreshedCorpus.refreshedOwners
        compiledSpecifications = refreshedCorpus.compiled
      } else {
        const requestPlanned = requestPlannedCompilation(options)
        const requestedCompilation = requestPlanned
          ? await compileRequestedSpecificationClosure(
              this.#root,
              anchors,
              options.select ?? [],
              inventory,
              sources,
              compile,
              options.signal,
            )
          : undefined
        specifications = requestedCompilation
          ? requestedCompilation.specifications
          : [
              ...(await compile(this.#root, directories, {
                maximumConcurrency:
                  TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
              })),
            ]
        completeCorpus = !requestPlanned || specifications.length === anchors.length
        refreshedSpecificationSources = specifications.map((value) => value.source)
        compiledSpecifications = specifications.length
        if (requestedCompilation) {
          this.phaseCompleted(
            'application.compile.plan',
            requestedCompilation.planningMilliseconds,
            {
              outcome: requestedCompilation.dependencyPlan.outcome,
              primarySpecifications: requestedCompilation.primaryOwners,
              preplannedSpecifications: requestedCompilation.dependencyPlan.owners.length,
              inspectedSources: requestedCompilation.dependencyPlan.inspectedSources,
              dependencyEdges: requestedCompilation.dependencyPlan.dependencyEdges,
              unavailableSources: requestedCompilation.dependencyPlan.unavailableSources,
              compilerWaves: requestedCompilation.waves,
              fallbackSpecifications: requestedCompilation.fallbackOwners,
              ...(requestedCompilation.fallbackSources.length
                ? { fallbackSources: requestedCompilation.fallbackSources.join(',') }
                : {}),
              ...(requestedCompilation.dependencyPlan.reason
                ? { reason: requestedCompilation.dependencyPlan.reason }
                : {}),
            },
          )
        }
      }
      compileMs = performance.now() - phase
      this.phaseCompleted('application.compile', compileMs, {
        specifications: compiledSpecifications,
        retainedSpecifications: specifications.length - compiledSpecifications,
        completeCorpus,
      })
      assertSpecificationInventory(specifications, inventory)
      if (statisticsRequested) {
        phase = performance.now()
        this.phaseStarted('application.statistics')
        const refreshedStatistics = await this.#dependencies.statistics({
          inventory,
          sources,
          ...(cachedCorpus?.statistics ? { previous: cachedCorpus.statistics } : {}),
          groupings: [
            ...defaultRepositoryStatisticsGroupings(),
            createRepositoryPathOwnershipGrouping(
              'module',
              anchors.map((anchor) => ({
                root: anchor.root,
                key: anchor.source,
                label: anchor.title,
              })),
            ),
          ],
          ...(options.signal ? { signal: options.signal } : {}),
        })
        statistics = refreshedStatistics.report
        statisticsWork = refreshedStatistics.work
        statisticsMs = performance.now() - phase
        this.phaseCompleted('application.statistics', statisticsMs, {
          analyzedFiles: statisticsWork.analyzedFiles.length,
          reusedFiles: statisticsWork.reusedFiles.length,
          removedFiles: statisticsWork.removedFiles.length,
        })
      } else {
        statistics = undefined
        this.phaseCompleted('application.statistics', 0, { outcome: 'not-requested' })
      }
      this.#corpus = {
        key: corpusKey,
        discoveryKey,
        specifications,
        inventory,
        sources,
        statistics,
        complete: completeCorpus,
        ...(completeCorpus ? {} : { request: requestKey }),
      }
    }
    const selected = selectApplicationSpecifications(this.#root, specifications, {
      ...(options.select ? { select: options.select } : {}),
      ...(options.focused !== undefined ? { focused: options.focused } : {}),
      ...(options.includeDependents !== undefined
        ? { includeDependents: options.includeDependents }
        : {}),
    })
    const analysisSpecifications = options.focused ? selected.qualification : specifications
    let schemaDependencies: readonly ApplicationSchemaDependencyResource[] = []
    if (options.schemaRoots?.length) {
      phase = performance.now()
      schemaDependencies = await this.loadSchemaDependencies(options.schemaRoots)
      compileMs += performance.now() - phase
    }
    options.signal?.throwIfAborted()

    let qualifications: readonly QualificationSnapshot[] = []
    let analysis: TypeSpecApplicationSnapshot['analysis']
    let analysisDiagnostics: readonly string[] = []
    let observationDiagnostics: readonly Diagnostic[] = []
    let analysisSnapshot: AnalysisSnapshotSet | undefined
    let changedSources: readonly SourceId[] = []
    let invalidatedPasses: readonly PassId[] = []
    let analysisMs = 0
    let qualificationMs = 0
    if (options.qualify) {
      phase = performance.now()
      this.phaseStarted('application.analysis')
      const residentSources = new Set(
        selected.selection.kind === 'focused' ? selected.selection.primary : [],
      )
      const refreshed = await this.#dependencies.analysis.refresh({
        specifications: analysisSpecifications,
        observationSpecifications: analysisSpecifications,
        refreshSpecifications: schemaDependencies.length
          ? analysisSpecifications.map((value) => value.source)
          : refreshedSpecificationSources,
        inventory,
        ...(schemaDependencies.length ? { schemaDependencies } : {}),
        ...(options.compilerAnalysis !== undefined
          ? { compilerAnalysis: options.compilerAnalysis }
          : {}),
        ...(options.changed ? { changed: options.changed } : {}),
        ...(inventoryChanges.length ? { changes: inventoryChanges } : {}),
        residentModules: selected.qualification
          .filter((specification) => residentSources.has(specification.source))
          .map((specification) => specification.module.id),
        ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      })
      analysisMs = performance.now() - phase
      this.phaseCompleted('application.analysis', analysisMs, {
        observedSpecifications: refreshedSpecificationSources.length,
      })
      analysisSnapshot = refreshed.snapshot
      observationDiagnostics = refreshed.observation?.diagnostics ?? []
      changedSources = sortedUnique(refreshed.results.flatMap((result) => result.changedSources))
      invalidatedPasses = sortedUnique(
        refreshed.results.flatMap((result) => result.invalidatedPasses),
      )
      try {
        phase = performance.now()
        this.phaseStarted('application.qualification')
        const profiles = applicationProfiles(this.#dependencies.profiles, options)
        const plan = planConformance(profiles, options.requestedProfiles)
        const hasUniverseProfiles = plan.ordered.some(
          (profile) => profile.manifest.evaluationScope !== 'specification',
        )
        const reusablePrevious =
          previous !== undefined &&
          (!hasUniverseProfiles || refreshed.affectedModules !== undefined)
            ? previous
            : undefined
        const refreshedOwners = new Set(refreshedSpecificationSources)
        const affectedModules = new Set(refreshed.affectedModules ?? [])
        const previousBySource = new Map(
          (reusablePrevious?.qualifications ?? [])
            .filter((value) => qualificationMatchesPlan(value, plan))
            .map((value) => [value.specification.source, value]),
        )
        const evaluatedSpecifications = selected.qualification.filter((specification) => {
          const prior = previousBySource.get(specification.source)
          return (
            !prior ||
            prior.specification.id !== specification.id ||
            refreshedOwners.has(specification.source) ||
            affectedModules.has(specification.module.id)
          )
        })
        const evaluated = await qualifySpecifications({
          specifications: evaluatedSpecifications,
          analysis: refreshed.snapshot,
          profiles,
          ...(options.requestedProfiles ? { requestedProfiles: options.requestedProfiles } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        })
        const evaluatedBySource = new Map(
          evaluated.map((value) => [value.specification.source, value]),
        )
        qualifications = selected.qualification.map((specification) => {
          const fresh = evaluatedBySource.get(specification.source)
          if (fresh) return fresh
          const prior = previousBySource.get(specification.source)
          if (!prior)
            throw new Error(`Qualification result is missing for ${specification.source}.`)
          return rebindQualificationSnapshot(prior, specification, refreshed.snapshot)
        })
        analysis = {
          id: refreshed.snapshot.id,
          inventory: refreshed.snapshot.inventory,
          universes: refreshed.snapshot.universes,
          generations: [...refreshed.snapshot.generations]
            .map(([universe, generation]) => ({ universe, generation }))
            .sort((left, right) => left.universe.localeCompare(right.universe)),
        }
        analysisDiagnostics = refreshed.diagnostics
        qualificationMs = performance.now() - phase
        this.phaseCompleted('application.qualification', qualificationMs, {
          specifications: evaluatedSpecifications.length,
          reusedSpecifications: qualifications.length - evaluatedSpecifications.length,
        })
      } catch (error) {
        await refreshed.snapshot.dispose()
        throw error
      }
    }

    const sharedDiagnostics: readonly Diagnostic[] = [
      ...(discoveredSpecificationCount
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
    ]
    const candidate = createApplicationSnapshot({
      repository: this.#repository,
      inventory: inventory.revision,
      capabilities,
      selection: selected.selection,
      specifications: selected.included,
      ...(statistics ? { statistics } : {}),
      qualifications,
      ...(analysis ? { analysis } : {}),
      diagnostics: [
        ...sharedDiagnostics,
        ...selected.qualification.flatMap((specification) => specification.diagnostics),
      ],
      analysisDiagnostics,
    })
    const snapshot = await this.publish(candidate, sources, analysisSnapshot)
    this.#currentRequestKey = requestKey
    if (
      completeCorpus &&
      this.#dependencies.checkpoint &&
      checkpointPublishEligible(options)
    ) {
      this.scheduleCheckpoint(
        {
          repository: this.#repository,
          inventory: inventory.revision,
          corpus: discoveryKey,
          request: requestKey,
        },
        { snapshot, specifications, inventory, ...(statistics ? { statistics } : {}) },
      )
    }
    return {
      snapshot,
      changes: applicationChanges(
        previous,
        snapshot,
        changedSources,
        invalidatedPasses,
        refreshedSpecificationSources,
      ),
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
      checkProjection: { sharedDiagnostics },
    }
  }

  private phaseStarted(phase: string): void {
    dispatchAnalysisTelemetry(this.#telemetry, {
      component: 'analysis',
      phase,
      metrics: { status: 'started' },
    })
  }

  private phaseCompleted(
    phase: string,
    durationMs: number,
    metrics: Readonly<Record<string, string | number | boolean>> = {},
  ): void {
    dispatchAnalysisTelemetry(this.#telemetry, {
      component: 'analysis',
      phase,
      durationNs: Math.round(durationMs * 1_000_000),
      metrics: { status: 'completed', ...metrics },
    })
  }

  private async loadSchemaDependencies(
    inputs: readonly string[],
  ): Promise<readonly ApplicationSchemaDependencyResource[]> {
    const roots: string[] = []
    for (const input of inputs) {
      const root = await this.#dependencies.resolveRoot(input)
      if (root !== this.#root && !roots.includes(root)) roots.push(root)
    }
    const resources: ApplicationSchemaDependencyResource[] = []
    for (const [ordinal, root] of roots.entries()) {
      const directories = await this.#dependencies.discover(root)
      const specifications = await this.#dependencies.compile(root, directories, {
        maximumConcurrency: TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
      })
      resources.push(
        ...applicationSchemaDependencies(
          ordinal,
          specifications.flatMap((specification) => specification.schemas),
        ),
      )
    }
    return resources
  }

  current(): TypeSpecApplicationSnapshot | undefined {
    if (!this.#current) return
    return this.#records.get(this.#current)?.snapshot
  }

  async open(
    snapshot: TypeSpecApplicationSnapshotId | undefined = this.#current,
  ): Promise<TypeSpecApplicationReader> {
    this.assertOpen()
    if (!snapshot) throw new Error('No TypeSpec application snapshot has been published.')
    const record = this.#records.get(snapshot)
    if (!record) throw new Error(`TypeSpec application snapshot is not retained: ${snapshot}`)
    record.readers += 1
    let disposed = false
    const assertReader = (): void => {
      if (disposed || record.disposed) throw new Error('TypeSpec application reader is disposed.')
    }
    return {
      snapshot: record.snapshot,
      async query(universe) {
        assertReader()
        if (!record.analysis) {
          throw new Error('This application snapshot has no analysis generations.')
        }
        return record.analysis.query(universe)
      },
      async source(request) {
        assertReader()
        return record.sources.read(request)
      },
      async dispose() {
        if (disposed) return
        disposed = true
        record.readers -= 1
        if (!record.retained && record.readers === 0) await disposeRecord(record)
      },
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#current = undefined
    this.#currentRequestKey = undefined
    this.#corpus = undefined
    const records = [...this.#records.values()]
    this.#records.clear()
    await this.settle()
    await Promise.all(records.map(disposeRecord))
    await this.#dependencies.analysis.dispose()
  }

  async settle(): Promise<TypeSpecApplicationSettlement> {
    await this.#checkpointWriter
    return Object.freeze({
      ...(this.#checkpointPublication
        ? { checkpoint: Object.freeze(this.#checkpointPublication) }
        : {}),
    })
  }

  private scheduleCheckpoint(
    expectation: ApplicationCheckpointExpectation,
    content: ApplicationCheckpointContent,
  ): void {
    if (
      !this.#dependencies.checkpoint ||
      this.#dependencies.checkpoint.publication === 'disabled'
    ) return
    this.#pendingCheckpoint = { expectation, content }
    if (this.#checkpointWriter) return
    this.#checkpointWriter = (async () => {
      // Publishing is advisory. Start it in a later task so synchronous packing cannot extend the
      // refresh/HMR critical path; dispose still drains the writer before releasing its stores.
      await new Promise<void>((resolve) => setImmediate(resolve))
      while (this.#pendingCheckpoint) {
        const pending = this.#pendingCheckpoint
        this.#pendingCheckpoint = undefined
        const started = performance.now()
        this.phaseStarted('application.checkpoint')
        try {
          await this.#dependencies.checkpoint!.publish(pending.expectation, pending.content)
          const durationMs = performance.now() - started
          this.#checkpointPublication = {
            repository: pending.expectation.repository,
            inventory: pending.expectation.inventory,
            outcome: 'published',
            durationMs,
          }
          this.phaseCompleted('application.checkpoint', durationMs, {
            outcome: 'published',
          })
        } catch (error) {
          const durationMs = performance.now() - started
          const name = error instanceof Error ? error.name : 'unknown'
          const message = error instanceof Error ? error.message : String(error)
          this.#checkpointPublication = {
            repository: pending.expectation.repository,
            inventory: pending.expectation.inventory,
            outcome: 'unavailable',
            durationMs,
            error: {
              code: 'APPLICATION_CHECKPOINT_PUBLICATION_UNAVAILABLE',
              name,
              message,
            },
          }
          this.phaseCompleted('application.checkpoint', durationMs, {
            outcome: 'unavailable',
            error: name,
            reason: message,
          })
        }
      }
    })().finally(() => {
      this.#checkpointWriter = undefined
    })
  }

  private async publish(
    snapshot: TypeSpecApplicationSnapshot,
    sources: RepositorySourceService,
    analysis: AnalysisSnapshotSet | undefined,
  ): Promise<TypeSpecApplicationSnapshot> {
    const existing = this.#records.get(snapshot.id)
    if (existing) {
      if (analysis) await analysis.dispose()
      this.#records.delete(snapshot.id)
      this.#records.set(snapshot.id, existing)
      this.#current = snapshot.id
      return existing.snapshot
    }
    const record: ApplicationRecord = {
      snapshot,
      analysis,
      sources,
      readers: 0,
      retained: true,
      disposed: false,
    }
    this.#records.set(snapshot.id, record)
    this.#current = snapshot.id
    while (this.#records.size > this.#maximumRetainedSnapshots) {
      const oldest = this.#records.entries().next().value as
        | [TypeSpecApplicationSnapshotId, ApplicationRecord]
        | undefined
      if (!oldest) break
      this.#records.delete(oldest[0])
      oldest[1].retained = false
      if (oldest[1].readers === 0) await disposeRecord(oldest[1])
    }
    return snapshot
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('TypeSpec application service is disposed.')
  }
}

interface ApplicationRecord {
  readonly snapshot: TypeSpecApplicationSnapshot
  readonly analysis?: AnalysisSnapshotSet
  readonly sources: RepositorySourceService
  readers: number
  retained: boolean
  disposed: boolean
}

interface ApplicationCorpus {
  readonly key: string
  readonly discoveryKey: string
  readonly specifications: readonly SpecificationSnapshot[]
  readonly inventory: RepositoryInventory
  readonly sources: RepositorySourceService
  readonly statistics?: RepositoryStatisticsReport
  readonly complete: boolean
  /** A partial corpus is reusable only for the identical normalized request. */
  readonly request?: string
}

async function disposeRecord(record: ApplicationRecord): Promise<void> {
  if (record.disposed) return
  record.disposed = true
  await record.analysis?.dispose()
}

function applicationChanges(
  previous: TypeSpecApplicationSnapshot | undefined,
  current: TypeSpecApplicationSnapshot,
  sources: readonly SourceId[],
  invalidatedPasses: readonly PassId[],
  refreshedSpecifications: readonly string[] = [],
): TypeSpecApplicationChanges {
  const before = new Map(previous?.specifications.map((value) => [value.source, value]) ?? [])
  const after = new Map(current.specifications.map((value) => [value.source, value]))
  return {
    ...(previous ? { previous: previous.id } : {}),
    specifications: {
      added: [...after.keys()].filter((source) => !before.has(source)).sort(),
      changed: [...after]
        .filter(([source, value]) => {
          const old = before.get(source)
          return old !== undefined && old.id !== value.id
        })
        .map(([source]) => source)
        .sort(),
      removed: [...before.keys()].filter((source) => !after.has(source)).sort(),
      refreshed: sortedUnique(refreshedSpecifications),
    },
    sources: sortedUnique(sources),
    invalidatedPasses: sortedUnique(invalidatedPasses),
  }
}

function qualificationMatchesPlan(
  qualification: QualificationSnapshot,
  plan: ReturnType<typeof planConformance>,
): boolean {
  if (
    qualification.profiles.length !== plan.ordered.length ||
    qualification.profiles.some((profile, index) => {
      const expected = plan.ordered[index]?.manifest
      return !expected || profile.id !== expected.id || profile.version !== expected.version
    })
  ) {
    return false
  }
  const previous = qualification.scope
  const expected = plan.scope
  if (previous.kind !== expected.kind || previous.authority !== expected.authority) return false
  if (previous.kind === 'full' || expected.kind === 'full') return previous.kind === expected.kind
  return (
    sameOrderedStrings(previous.requestedProfiles, expected.requestedProfiles) &&
    sameOrderedStrings(previous.includedProfiles, expected.includedProfiles) &&
    sameOrderedStrings(previous.supportProfiles, expected.supportProfiles)
  )
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sortedUnique<Value extends string>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function observedSpecificationCompiler(
  compile: typeof compileSpecificationSnapshots,
  telemetry: AnalysisTelemetrySink | undefined,
): typeof compileSpecificationSnapshots {
  return (root, directories, options = {}) =>
    compile(root, directories, {
      ...options,
      onPhase: (phase: SpecificationCompilationPhase) => {
        try {
          options.onPhase?.(phase)
        } catch {
          // Consumer measurement remains diagnostic-only.
        }
        dispatchAnalysisTelemetry(telemetry, {
          component: 'analysis',
          phase: `application.compile.${phase.phase}`,
          durationNs: Math.round(phase.durationMs * 1_000_000),
          metrics: {
            status: 'completed',
            items: phase.items,
            ...(phase.programs === undefined ? {} : { programs: phase.programs }),
            ...(phase.sessions === undefined ? {} : { sessions: phase.sessions }),
            ...(phase.retries === undefined ? {} : { retries: phase.retries }),
            ...(phase.fallbacks === undefined ? {} : { fallbacks: phase.fallbacks }),
            ...(phase.workerPeakResidentBytes === undefined
              ? {}
              : { workerPeakResidentBytes: phase.workerPeakResidentBytes }),
            ...(phase.workerResidentUpperBoundBytes === undefined
              ? {}
              : { workerResidentUpperBoundBytes: phase.workerResidentUpperBoundBytes }),
            ...(phase.parentPeakResidentBytes === undefined
              ? {}
              : { parentPeakResidentBytes: phase.parentPeakResidentBytes }),
            ...(phase.overlap ? { overlap: phase.overlap } : {}),
          },
        })
      },
    })
}

/**
 * Normalize only semantic refresh inputs. Inventory identity independently pins every local byte;
 * explicit invalidation/change hints and external schema roots deliberately bypass the fast path.
 */
function applicationRefreshKey(options: TypeSpecApplicationRefreshOptions): string {
  return JSON.stringify({
    capabilities: applicationCapabilities(options.requestedCapabilities),
    exclude: sortedUnique(options.exclude ?? []),
    select: sortedUnique(options.select ?? []),
    focused: options.focused === true,
    includeDependents: options.includeDependents === true,
    requireCompleteLayout: options.requireCompleteLayout === true,
    requireExactLayout: options.requireExactLayout === true,
    requestedProfiles: sortedUnique(options.requestedProfiles ?? []),
    compilerAnalysis: options.compilerAnalysis !== false,
    qualify: options.qualify === true,
  })
}

const DEFAULT_APPLICATION_CAPABILITIES = [
  'declaration-models',
  'declaration-navigation',
  'repository-statistics',
] as const

function applicationCapabilities(
  requested: readonly TypeSpecApplicationCapability[] | undefined,
): readonly TypeSpecApplicationCapability[] {
  const capabilities = sortedUnique(requested ?? DEFAULT_APPLICATION_CAPABILITIES)
  for (const capability of capabilities) {
    if (
      capability !== 'declaration-models' &&
      capability !== 'declaration-navigation' &&
      capability !== 'repository-statistics'
    ) {
      throw new TypeError(`Unknown application capability: ${String(capability)}`)
    }
  }
  if (
    capabilities.includes('declaration-navigation') &&
    !capabilities.includes('declaration-models')
  ) {
    throw new TypeError('declaration-navigation requires declaration-models.')
  }
  return capabilities
}

function checkpointLoadEligible(options: TypeSpecApplicationRefreshOptions): boolean {
  return (
    checkpointPublishEligible(options) &&
    (options.changed?.length ?? 0) === 0 &&
    options.invalidate !== true
  )
}

function checkpointPublishEligible(options: TypeSpecApplicationRefreshOptions): boolean {
  return options.invalidate !== true && (options.schemaRoots?.length ?? 0) === 0
}

function applicationCorpusKey(
  inventory: string,
  exclude: readonly string[],
  capabilities: readonly TypeSpecApplicationCapability[],
): string {
  return JSON.stringify({
    inventory,
    exclude: sortedUnique(exclude),
    declarationModels: capabilities.includes('declaration-models'),
    declarationNavigation: capabilities.includes('declaration-navigation'),
  })
}

function specificationCompilerForCapabilities(
  compile: typeof compileSpecificationSnapshots,
  capabilities: readonly TypeSpecApplicationCapability[],
): typeof compileSpecificationSnapshots {
  const includeDeclarationNavigation = capabilities.includes('declaration-navigation')
  const includeDeclarationModels = capabilities.includes('declaration-models')
  return (root, directories, options = {}) =>
    compile(root, directories, {
      ...options,
      includeDeclarationModels,
      includeDeclarationNavigation,
    })
}

function assertApplicationRoot(root: string): void {
  const segments = resolve(root).split(sep).filter(Boolean)
  if (segments.includes('node_modules') || segments.includes('.pnpm-store')) {
    throw new Error('Codegraph application roots cannot be dependency stores.')
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      (segments[index] === 'evidence' || segments[index] === 'benchmark') &&
      segments[index + 1] === 'artifacts'
    ) {
      throw new Error('Codegraph application roots cannot be generated evidence artifacts.')
    }
  }
}

function requestPlannedCompilation(options: TypeSpecApplicationRefreshOptions): boolean {
  return (
    options.focused === true &&
    (options.select?.length ?? 0) > 0 &&
    options.includeDependents !== true
  )
}

function applicationCheckpointProjection(
  root: string,
  options: TypeSpecApplicationRefreshOptions,
  capabilities: readonly TypeSpecApplicationCapability[],
): { readonly projection: NonNullable<ApplicationCheckpointExpectation['projection']> } | undefined {
  if (!requestPlannedCompilation(options)) return
  try {
    return {
      projection: {
        requested: normalizeApplicationSelectionTargets(root, options.select ?? []),
        includeDependents: false,
        capabilities,
      },
    }
  } catch {
    // Invalid selection remains a canonical application diagnostic; eager checkpoint admission
    // preserves that path instead of turning an advisory projection hint into a thrown error.
    return
  }
}

function applicationProfiles(
  profiles: readonly ConformanceProfile[],
  options: TypeSpecApplicationRefreshOptions,
): readonly ConformanceProfile[] {
  if (!options.requireCompleteLayout && !options.requireExactLayout) return profiles
  const layout = createModuleLayoutConformanceProfile({
    requireComplete: Boolean(options.requireCompleteLayout || options.requireExactLayout),
    requireExact: Boolean(options.requireExactLayout),
  })
  const replaced = profiles.map((profile) =>
    profile.manifest.id === MODULE_LAYOUT_PROFILE_ID ? layout : profile,
  )
  return replaced.some((profile) => profile.manifest.id === MODULE_LAYOUT_PROFILE_ID)
    ? replaced
    : [...replaced, layout]
}

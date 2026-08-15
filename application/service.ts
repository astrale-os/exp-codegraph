import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  AnalysisSnapshotSet,
  AnalysisTelemetrySink,
  PassId,
  RepositoryId,
  SourceId,
} from '../analysis/index.ts'
import type { ConformanceProfile, QualificationSnapshot } from '../conformance/index.ts'
import type { RepositorySourceService, RepositoryStatisticsReport } from '../repository/index.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'
import type { ApplicationAnalysisWorkspace } from './analysis/index.ts'
import type { ApplicationSchemaDependencyResource } from './observation/index.ts'
import { withOperationSnapshot } from '../source/operation-snapshot.ts'
import type {
  TypeSpecApplicationChanges,
  TypeSpecApplicationReader,
  TypeSpecApplicationRefresh,
  TypeSpecApplicationRefreshOptions,
  TypeSpecApplicationService,
  TypeSpecApplicationSnapshot,
  TypeSpecApplicationSnapshotId,
} from './model.ts'

import {
  APPLICATION_REPOSITORY_EXCLUDES,
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from './discovery/index.ts'
import {
  MODULE_LAYOUT_PROFILE_ID,
  createModuleLayoutConformanceProfile,
  createTypeSpecConformanceProfiles,
  qualifySpecifications,
} from '../conformance/index.ts'
import {
  analyzeRepositoryStatistics,
  createRepositoryPathOwnershipGrouping,
  createRepositorySourceService,
  defaultRepositoryStatisticsGroupings,
  inventoryRepository,
} from '../repository/index.ts'
import { compileSpecificationSnapshots } from '../specification/index.ts'
import { deriveAnalysisId } from '../analysis/index.ts'
import {
  createApplicationAnalysisWorkspace,
  createCodegraphApplicationSessionFactory,
  type ApplicationAnalysisWorkspaceOptions,
  type CodegraphApplicationSessionOptions,
} from './analysis/index.ts'
import { assertSpecificationInventory, createApplicationSnapshot } from './snapshot/index.ts'
import { selectApplicationSpecifications } from './selection/index.ts'
import { applicationSchemaDependencies } from './observation/index.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from './limits.ts'

export interface TypeSpecApplicationDependencies {
  readonly resolveRoot: (input: string) => Promise<string>
  readonly discover: typeof discoverSpecificationDirectories
  readonly compile: typeof compileSpecificationSnapshots
  readonly inventory: typeof inventoryRepository
  readonly sources: typeof createRepositorySourceService
  readonly statistics: typeof analyzeRepositoryStatistics
  readonly analysis: ApplicationAnalysisWorkspace
  readonly profiles: readonly ConformanceProfile[]
}

export interface TypeSpecApplicationOptions {
  readonly root: string
  /** Portable repository key; required when the root package has no stable package name. */
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly telemetry?: AnalysisTelemetrySink
  readonly analysis?: Omit<ApplicationAnalysisWorkspaceOptions, 'root' | 'repository' | 'sessions'>
  readonly native?: CodegraphApplicationSessionOptions
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
  const repository = await repositoryIdentity(root, options.repository)
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
  return new HeadlessTypeSpecApplicationService(root, repository, {
    resolveRoot: injected.resolveRoot ?? resolveApplicationRoot,
    discover: injected.discover ?? discoverSpecificationDirectories,
    compile: injected.compile ?? compileSpecificationSnapshots,
    inventory: injected.inventory ?? inventoryRepository,
    sources: injected.sources ?? createRepositorySourceService,
    statistics: injected.statistics ?? analyzeRepositoryStatistics,
    analysis,
    profiles: injected.profiles ?? createTypeSpecConformanceProfiles(),
  }, options.maximumRetainedSnapshots ?? TYPE_SPEC_APPLICATION_LIMITS.maximumRetainedSnapshots)
}

async function repositoryIdentity(root: string, explicit: string | undefined): Promise<RepositoryId> {
  let key = explicit
  if (!key) {
    try {
      const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
        readonly name?: unknown
      }
      if (typeof manifest.name === 'string' && manifest.name.trim()) key = `package:${manifest.name}`
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
  readonly #records = new Map<TypeSpecApplicationSnapshotId, ApplicationRecord>()
  readonly #root: string
  readonly #repository: RepositoryId
  readonly #dependencies: TypeSpecApplicationDependencies
  readonly #maximumRetainedSnapshots: number

  constructor(
    root: string,
    repository: RepositoryId,
    dependencies: TypeSpecApplicationDependencies,
    maximumRetainedSnapshots: number,
  ) {
    this.#root = root
    this.#repository = repository
    this.#dependencies = dependencies
    this.#maximumRetainedSnapshots = maximumRetainedSnapshots
    if (!Number.isSafeInteger(maximumRetainedSnapshots) || maximumRetainedSnapshots < 1) {
      throw new Error('maximumRetainedSnapshots must be a positive safe integer.')
    }
  }

  async refresh(options: TypeSpecApplicationRefreshOptions = {}): Promise<TypeSpecApplicationRefresh> {
    return withOperationSnapshot(() => this.refreshSnapshot(options))
  }

  private async refreshSnapshot(
    options: TypeSpecApplicationRefreshOptions,
  ): Promise<TypeSpecApplicationRefresh> {
    this.assertOpen()
    const started = performance.now()
    let phase = started
    options.signal?.throwIfAborted()
    const inventory = await this.#dependencies.inventory({
      repository: this.#repository,
      root: this.#root,
      scope: { exclude: APPLICATION_REPOSITORY_EXCLUDES },
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const inventoryMs = performance.now() - phase
    const previous = this.current()
    const requestKey = applicationRefreshKey(options)
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
          discoverMs: 0,
          compileMs: 0,
          inventoryMs,
          statisticsMs: 0,
          analysisMs: 0,
          qualificationMs: 0,
        },
      }
    }
    const corpusKey = applicationCorpusKey(inventory.revision, options.exclude ?? [])
    let specifications: readonly SpecificationSnapshot[]
    let sources: RepositorySourceService
    let statistics: RepositoryStatisticsReport
    let discoverMs = 0
    let compileMs = 0
    let statisticsMs = 0
    const cachedCorpus = this.#corpus
    if (cachedCorpus?.key === corpusKey) {
      specifications = cachedCorpus.specifications
      sources = cachedCorpus.sources
      statistics = cachedCorpus.statistics
    } else {
      phase = performance.now()
      const directories = await this.#dependencies.discover(this.#root, {
        ...(options.exclude ? { exclude: options.exclude } : {}),
      })
      discoverMs = performance.now() - phase
      phase = performance.now()
      specifications = [
        ...(await this.#dependencies.compile(
          this.#root,
          directories,
          {
            maximumConcurrency:
              TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
          },
        )),
      ]
      compileMs = performance.now() - phase
      assertSpecificationInventory(specifications, inventory)
      phase = performance.now()
      sources = this.#dependencies.sources(this.#root, inventory)
      statistics = await this.#dependencies.statistics({
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
      statisticsMs = performance.now() - phase
      this.#corpus = { key: corpusKey, specifications, sources, statistics }
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
      })
      analysisMs = performance.now() - phase
      analysisSnapshot = refreshed.snapshot
      observationDiagnostics = refreshed.observation?.diagnostics ?? []
      changedSources = sortedUnique(refreshed.results.flatMap((result) => result.changedSources))
      invalidatedPasses = sortedUnique(
        refreshed.results.flatMap((result) => result.invalidatedPasses),
      )
      try {
        phase = performance.now()
        const profiles = applicationProfiles(this.#dependencies.profiles, options)
        qualifications = await qualifySpecifications({
          specifications: selected.qualification,
          analysis: refreshed.snapshot,
          profiles,
          ...(options.requestedProfiles
            ? { requestedProfiles: options.requestedProfiles }
            : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        })
        analysis = {
          id: refreshed.snapshot.id,
          inventory: refreshed.snapshot.inventory,
          universes: refreshed.snapshot.universes,
        }
        analysisDiagnostics = refreshed.diagnostics
        qualificationMs = performance.now() - phase
      } catch (error) {
        await refreshed.snapshot.dispose()
        throw error
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
    })
    const snapshot = await this.publish(candidate, sources, analysisSnapshot)
    this.#currentRequestKey = requestKey
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
    }
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
      const specifications = await this.#dependencies.compile(
        root,
        directories,
        {
          maximumConcurrency:
            TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
        },
      )
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
    await Promise.all(records.map(disposeRecord))
    await this.#dependencies.analysis.dispose()
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
  readonly specifications: readonly SpecificationSnapshot[]
  readonly sources: RepositorySourceService
  readonly statistics: RepositoryStatisticsReport
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
    },
    sources: sortedUnique(sources),
    invalidatedPasses: sortedUnique(invalidatedPasses),
  }
}

function sortedUnique<Value extends string>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

/**
 * Normalize only semantic refresh inputs. Inventory identity independently pins every local byte;
 * explicit invalidation/change hints and external schema roots deliberately bypass the fast path.
 */
function applicationRefreshKey(options: TypeSpecApplicationRefreshOptions): string {
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
  })
}

function applicationCorpusKey(inventory: string, exclude: readonly string[]): string {
  return JSON.stringify({ inventory, exclude: sortedUnique(exclude) })
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

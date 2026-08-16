import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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
import { dispatchAnalysisTelemetry } from '../analysis/profiling/dispatch.ts'
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
  return new HeadlessTypeSpecApplicationService(
    root,
    repository,
    {
      resolveRoot: injected.resolveRoot ?? resolveApplicationRoot,
      discover: injected.discover ?? discoverSpecificationDirectories,
      compile: injected.compile ?? compileSpecificationSnapshots,
      inventory: injected.inventory ?? inventoryRepository,
      sources: injected.sources ?? createRepositorySourceService,
      statistics: injected.statistics ?? analyzeRepositoryStatistics,
      analysis,
      profiles: injected.profiles ?? createTypeSpecConformanceProfiles(),
    },
    options.maximumRetainedSnapshots ?? TYPE_SPEC_APPLICATION_LIMITS.maximumRetainedSnapshots,
    options.telemetry,
  )
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
    this.phaseStarted('application.inventory')
    const inventory = await this.#dependencies.inventory({
      repository: this.#repository,
      root: this.#root,
      scope: { exclude: APPLICATION_REPOSITORY_EXCLUDES },
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const inventoryMs = performance.now() - phase
    this.phaseCompleted('application.inventory', inventoryMs)
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
    const discoveryKey = applicationDiscoveryKey(options.exclude ?? [])
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
      this.phaseStarted('application.discovery')
      const directories = await this.#dependencies.discover(this.#root, {
        ...(options.exclude ? { exclude: options.exclude } : {}),
      })
      discoverMs = performance.now() - phase
      this.phaseCompleted('application.discovery', discoverMs, { specifications: directories.length })
      phase = performance.now()
      this.phaseStarted('application.compile')
      specifications =
        cachedCorpus?.discoveryKey === discoveryKey && (options.changed?.length ?? 0) > 0
          ? await refreshSpecificationCorpus(
              this.#root,
              directories,
              cachedCorpus.specifications,
              options.changed ?? [],
              this.#dependencies.compile,
            )
          : [
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
      this.phaseCompleted('application.compile', compileMs, { specifications: specifications.length })
      assertSpecificationInventory(specifications, inventory)
      phase = performance.now()
      this.phaseStarted('application.statistics')
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
      this.phaseCompleted('application.statistics', statisticsMs)
      this.#corpus = { key: corpusKey, discoveryKey, specifications, sources, statistics }
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
      this.phaseCompleted('application.analysis', analysisMs)
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
        this.phaseCompleted('application.qualification', qualificationMs, {
          specifications: qualifications.length,
        })
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
  readonly discoveryKey: string
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

function applicationDiscoveryKey(exclude: readonly string[]): string {
  return JSON.stringify({ exclude: sortedUnique(exclude) })
}

async function refreshSpecificationCorpus(
  root: string,
  directories: readonly string[],
  previous: readonly SpecificationSnapshot[],
  changed: readonly string[],
  compile: typeof compileSpecificationSnapshots,
): Promise<readonly SpecificationSnapshot[]> {
  const available = new Map(
    directories.map((directory) => [portable(relative(root, resolve(directory))), resolve(directory)]),
  )
  const retained = new Map(
    previous.map((specification) => [
      portable(relative(root, dirname(resolve(root, specification.source)))),
      specification,
    ]),
  )
  const affected = new Set<string>()
  for (const directory of available.keys()) {
    if (!retained.has(directory)) affected.add(directory)
  }
  for (const input of changed) {
    const source = await workspacePath(root, input)
    if (!source) continue
    if (
      source === '.spec/api.d.ts' ||
      source.endsWith('/.spec/api.d.ts') ||
      (source.endsWith('.d.ts') && !source.startsWith('.spec/') && !source.includes('/.spec/'))
    ) {
      // Public declarations can affect any importing specification. Until the normative compiler
      // exposes an exact reverse-dependency closure, retaining a dependent snapshot is unsound.
      for (const directory of available.keys()) affected.add(directory)
      continue
    }
    const owner = specificationDirectory(source)
    if (owner && available.has(owner)) affected.add(owner)
    for (const [directory, specification] of retained) {
      if (!available.has(directory)) continue
      if (
        normativeSpecificationSources(specification).has(source) ||
        packageManifestAffects(source, specification.root)
      ) affected.add(directory)
    }
  }
  const compiled = affected.size
    ? await compile(
        root,
        [...affected].map((directory) => available.get(directory)!).filter(Boolean),
        {
          maximumConcurrency:
            TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
        },
      )
    : []
  const replacements = new Map(
    compiled.map((specification) => [
      portable(relative(root, dirname(resolve(root, specification.source)))),
      specification,
    ]),
  )
  return [...available.keys()]
    .map((directory) => replacements.get(directory) ?? retained.get(directory))
    .filter((value): value is SpecificationSnapshot => value !== undefined)
    .sort((left, right) => left.source.localeCompare(right.source))
}

function normativeSpecificationSources(specification: SpecificationSnapshot): ReadonlySet<string> {
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
  ]
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
  ])
}

function packageManifestAffects(source: string, moduleRoot: string): boolean {
  if (!source.endsWith('/package.json') && source !== 'package.json') return false
  const packageRoot = source === 'package.json' ? '.' : source.slice(0, -'/package.json'.length)
  return packageRoot === '.' || moduleRoot === packageRoot || moduleRoot.startsWith(`${packageRoot}/`)
}

function specificationDirectory(source: string): string | undefined {
  const marker = source.indexOf('/.spec/')
  if (marker >= 0) return `${source.slice(0, marker)}/.spec`
  return source.startsWith('.spec/') ? '.spec' : undefined
}

async function workspacePath(root: string, input: string): Promise<string | undefined> {
  let target = resolve(root, input)
  try {
    target = await realpath(target)
  } catch {
    try {
      target = join(await realpath(dirname(target)), basename(target))
    } catch {
      return
    }
  }
  const path = relative(root, target)
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) return
  return portable(path)
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
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

import type {
  AnalysisGenerationId,
  AnalysisSnapshotSet,
  AnalysisStore,
  NativeModuleBoundary,
  ProjectUniverseId,
  SourceManifestId,
} from '../../analysis/index.ts'
import type { TypeScriptAnalysisService } from '../../analysis/typescript/index.ts'

import { createMemoryAnalysisStore } from '../../analysis/index.ts'
import {
  createTypeScriptAnalysisService,
  TYPESCRIPT_MODULE_FACT_NAMESPACE,
} from '../../analysis/typescript/index.ts'
import { resolveApplicationModuleBoundaries } from './boundary.ts'
import { materializeApplicationObservations } from '../observation/index.ts'
import type {
  ApplicationAnalysisRefresh,
  ApplicationAnalysisRefreshOptions,
  ApplicationAnalysisWorkspace,
  ApplicationAnalysisWorkspaceOptions,
} from './model.ts'

/** Compose resident ttsc project sessions into one immutable, generation-pinned repository view. */
export function createApplicationAnalysisWorkspace(
  options: ApplicationAnalysisWorkspaceOptions,
): ApplicationAnalysisWorkspace {
  return new ResidentApplicationAnalysisWorkspace(options)
}

class ResidentApplicationAnalysisWorkspace implements ApplicationAnalysisWorkspace {
  readonly #store: AnalysisStore
  readonly #ownsStore: boolean
  readonly #services = new Map<string, TypeScriptAnalysisService>()
  #boundaryDigest = ''
  #adoptedGenerations = new Map<ProjectUniverseId, AnalysisGenerationId>()
  #adoptedInventory: SourceManifestId | undefined
  #disposed = false
  readonly #options: ApplicationAnalysisWorkspaceOptions

  constructor(options: ApplicationAnalysisWorkspaceOptions) {
    this.#options = options
    this.#store =
      options.store ??
      createMemoryAnalysisStore({
        maximumRetainedGenerations: options.maximumRetainedGenerations ?? 2,
        ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      })
    this.#ownsStore = options.store === undefined
  }

  async refresh(options: ApplicationAnalysisRefreshOptions): Promise<ApplicationAnalysisRefresh> {
    this.assertOpen()
    options.signal?.throwIfAborted()
    const resolution = options.compilerAnalysis === false
      ? { boundaries: [], diagnostics: [] }
      : await resolveApplicationModuleBoundaries(
          this.#options.root,
          options.specifications,
        )
    const byProject = groupByProject(resolution.boundaries)
    const digest = JSON.stringify([...byProject])
    if (options.compilerAnalysis !== false && digest !== this.#boundaryDigest) {
      await this.disposeServices()
      for (const [project, modules] of byProject) {
        this.#services.set(
          project,
          await createTypeScriptAnalysisService({
            project: {
              root: this.#options.root,
              config: project,
              capabilities: [TYPESCRIPT_MODULE_FACT_NAMESPACE],
              modules,
            },
            sessions: this.#options.sessions,
            store: this.#store,
            ...(this.#options.telemetry ? { telemetry: this.#options.telemetry } : {}),
          }),
        )
      }
      this.#boundaryDigest = digest
    }

    const results = []
    for (const [project] of byProject) {
      options.signal?.throwIfAborted()
      const service = this.#services.get(project)
      if (!service) throw new Error(`Application analysis service is missing for ${project}.`)
      results.push(
        await service.refresh({
          ...(options.changed ? { changed: options.changed } : {}),
          ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      )
    }
    const generations = new Map<ProjectUniverseId, AnalysisGenerationId>(
      options.compilerAnalysis === false && this.#adoptedInventory === options.inventory.revision
        ? this.#adoptedGenerations
        : [],
    )
    for (const [universe, generation] of results.map(
      (result) => [result.generation.universe, result.generation.id] as const,
    )) {
      generations.set(universe, generation)
    }
    const observation = await materializeApplicationObservations({
      root: this.#options.root,
      store: this.#store,
      inventory: options.inventory,
      specifications: options.observationSpecifications ?? options.specifications,
      ...(options.refreshSpecifications
        ? { refresh: options.refreshSpecifications }
        : {}),
      ...(options.schemaDependencies
        ? { schemaDependencies: options.schemaDependencies }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    generations.set(observation.universe, observation.generation.id)
    const snapshot = await this.#store.snapshotSet(generations, options.inventory.revision)
    this.#adoptedGenerations = new Map(generations)
    this.#adoptedInventory = options.inventory.revision
    return {
      snapshot,
      universes: snapshot.universes,
      boundaries: resolution.boundaries,
      results,
      observation,
      diagnostics: [
        ...resolution.diagnostics.map(
          (diagnostic) =>
            `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`,
        ),
        ...results.flatMap((result) => result.diagnostics),
      ],
    }
  }

  async open(
    generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>,
    inventory: SourceManifestId,
  ): Promise<AnalysisSnapshotSet> {
    this.assertOpen()
    const snapshot = await this.#store.snapshotSet(generations, inventory)
    this.#adoptedGenerations = new Map(generations)
    this.#adoptedInventory = inventory
    return snapshot
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#adoptedGenerations.clear()
    this.#adoptedInventory = undefined
    await this.disposeServices()
    if (this.#ownsStore) await this.#store.dispose()
  }

  private async disposeServices(): Promise<void> {
    const services = [...this.#services.values()]
    this.#services.clear()
    const results = await Promise.allSettled(services.map((service) => service.dispose()))
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (rejected) throw rejected.reason
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('Application analysis workspace is disposed.')
  }
}

function groupByProject(
  boundaries: readonly NativeModuleBoundary[],
): ReadonlyMap<string, readonly NativeModuleBoundary[]> {
  const values = new Map<string, NativeModuleBoundary[]>()
  for (const boundary of boundaries) {
    const current = values.get(boundary.project) ?? []
    current.push(boundary)
    values.set(boundary.project, current)
  }
  return new Map(
    [...values]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([project, current]) => [
        project,
        current.sort((left, right) => left.id.localeCompare(right.id)),
      ]),
  )
}

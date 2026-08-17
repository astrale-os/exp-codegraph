import type { AnalysisGeneration } from '../../generation/index.ts'
import type {
  AnalysisGenerationId,
  ProjectUniverseId,
  SnapshotSetId,
  SourceManifestId,
} from '../../identity/index.ts'
import type { AnalysisQuery, AnalysisSnapshotSet } from '../../query/index.ts'

import { deriveAnalysisSnapshotSetId } from '../../query/index.ts'

export class SQLiteSnapshotSet implements AnalysisSnapshotSet {
  readonly id: SnapshotSetId
  readonly inventory: SourceManifestId
  readonly generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>
  readonly universes: readonly ProjectUniverseId[]
  readonly #generations: ReadonlyMap<ProjectUniverseId, AnalysisGeneration>
  readonly #openQuery: (
    universe: ProjectUniverseId,
    generation: AnalysisGenerationId,
  ) => Promise<AnalysisQuery>
  readonly #release: () => void | Promise<void>
  #disposed = false

  constructor(
    generations: ReadonlyMap<ProjectUniverseId, AnalysisGeneration>,
    inventory: SourceManifestId,
    openQuery: (
      universe: ProjectUniverseId,
      generation: AnalysisGenerationId,
    ) => Promise<AnalysisQuery>,
    release: () => void | Promise<void>,
  ) {
    this.#generations = generations
    this.#openQuery = openQuery
    this.#release = release
    this.inventory = inventory
    this.universes = [...generations.keys()].sort()
    this.generations = new Map(
      this.universes.map((universe) => [universe, generations.get(universe)!.id]),
    )
    this.id = deriveAnalysisSnapshotSetId(this.generations, inventory)
  }

  query(universe: ProjectUniverseId): Promise<AnalysisQuery> {
    if (this.#disposed) throw new Error('Analysis snapshot set is disposed.')
    const generation = this.#generations.get(universe)
    if (!generation) throw new Error(`Universe ${universe} is not in this snapshot set.`)
    return this.#openQuery(universe, generation.id)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#release()
  }
}

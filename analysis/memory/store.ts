import type { FactTransaction } from '../generation/index.ts'
import type {
  AnalysisGenerationId,
  ProjectUniverseId,
  SourceManifestId,
} from '../identity/index.ts'
import type {
  AnalysisQuery,
  AnalysisSnapshotSet,
  AnalysisStore,
} from '../query/index.ts'
import {
  createQuery,
  createSnapshotSet,
  materializeTransaction,
  type MaterializedGeneration,
} from '../internal/state.ts'

export interface MemoryAnalysisStoreOptions {
  readonly maximumRetainedGenerations?: number
}

interface RetainedGeneration {
  readonly value: MaterializedGeneration
  leases: number
}

export function createMemoryAnalysisStore(options: MemoryAnalysisStoreOptions = {}): AnalysisStore {
  return new MemoryAnalysisStore(options)
}

class MemoryAnalysisStore implements AnalysisStore {
  readonly #maximumRetained: number
  readonly #universes = new Map<ProjectUniverseId, Map<number, RetainedGeneration>>()
  readonly #current = new Map<ProjectUniverseId, number>()
  #disposed = false

  constructor(options: MemoryAnalysisStoreOptions) {
    this.#maximumRetained = options.maximumRetainedGenerations ?? 4
    if (!Number.isSafeInteger(this.#maximumRetained) || this.#maximumRetained < 1) {
      throw new RangeError('maximumRetainedGenerations must be a positive integer.')
    }
  }

  async current(universe: ProjectUniverseId) {
    this.assertOpen()
    return this.currentValue(universe)?.generation
  }

  async commit(
    transaction: FactTransaction,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertOpen()
    options.signal?.throwIfAborted()
    const universe = transaction.next.universe
    const next = materializeTransaction(this.currentValue(universe), transaction)
    options.signal?.throwIfAborted()
    let retained = this.#universes.get(universe)
    if (!retained) {
      retained = new Map()
      this.#universes.set(universe, retained)
    }
    retained.set(next.generation.sequence, { value: next, leases: 0 })
    this.#current.set(universe, next.generation.sequence)
    this.collect(universe)
  }

  async open(
    universe: ProjectUniverseId,
    generation?: AnalysisGenerationId,
  ): Promise<AnalysisQuery> {
    this.assertOpen()
    const retained = this.retained(universe, generation)
    retained.leases++
    return createQuery(retained.value, () => {
      retained.leases--
      this.collect(universe)
    })
  }

  async snapshotSet(
    generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>,
    inventory: SourceManifestId,
  ): Promise<AnalysisSnapshotSet> {
    this.assertOpen()
    const retained = new Map<ProjectUniverseId, RetainedGeneration>()
    try {
      for (const [universe, generation] of generations) {
        const entry = this.retained(universe, generation)
        entry.leases++
        retained.set(universe, entry)
      }
    } catch (error) {
      for (const entry of retained.values()) entry.leases--
      throw error
    }
    return createSnapshotSet(
      new Map([...retained].map(([universe, entry]) => [universe, entry.value])),
      inventory,
      (universe, generation) => this.open(universe, generation),
      () => {
        for (const [universe, entry] of retained) {
          entry.leases--
          this.collect(universe)
        }
      },
    )
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#current.clear()
    this.#universes.clear()
  }

  private currentValue(universe: ProjectUniverseId): MaterializedGeneration | undefined {
    const sequence = this.#current.get(universe)
    return sequence ? this.#universes.get(universe)?.get(sequence)?.value : undefined
  }

  private retained(
    universe: ProjectUniverseId,
    generation?: AnalysisGenerationId,
  ): RetainedGeneration {
    const values = this.#universes.get(universe)
    const sequence = generation
      ? [...(values?.entries() ?? [])]
          .filter(([, entry]) => entry.value.generation.id === generation)
          .sort(([left], [right]) => right - left)[0]?.[0]
      : this.#current.get(universe)
    if (!sequence) throw new Error(`No analysis generation exists for universe ${universe}.`)
    const retained = values?.get(sequence)
    if (!retained) {
      throw new Error(`Analysis generation ${generation ?? String(sequence)} is not retained.`)
    }
    return retained
  }

  private collect(universe: ProjectUniverseId): void {
    const values = this.#universes.get(universe)
    if (!values || values.size <= this.#maximumRetained) return
    const current = this.#current.get(universe)
    const candidates = [...values]
      .filter(([sequence, retained]) => sequence !== current && retained.leases === 0)
      .sort(([, left], [, right]) => left.value.generation.sequence - right.value.generation.sequence)
    while (values.size > this.#maximumRetained && candidates.length) {
      values.delete(candidates.shift()![0])
    }
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('Analysis store is disposed.')
  }
}

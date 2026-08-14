import type { CatalogSourcePayload, CatalogSpecPayload } from '../viewer-host/catalog.ts'
import type { CatalogSnapshot } from './catalog-snapshot.ts'

import { specPayloadKey } from './catalog-snapshot.ts'

export interface CatalogPublication {
  readonly changed: boolean
  readonly generation: string
  readonly changedSpecs: readonly string[]
  readonly removedSpecs: readonly string[]
}

export interface CatalogSnapshotStoreOptions {
  readonly specCapacity?: number
  readonly sourceCapacity?: number
}

/** Retain the current snapshot plus a bounded content-addressed payload history for HMR races. */
export class CatalogSnapshotStore {
  #current: CatalogSnapshot | undefined
  readonly #specs = new Map<string, CatalogSpecPayload>()
  readonly #sources = new Map<string, CatalogSourcePayload>()
  readonly #specCapacity: number
  readonly #sourceCapacity: number

  constructor(options: CatalogSnapshotStoreOptions = {}) {
    this.#specCapacity = positiveInteger(options.specCapacity, 128)
    this.#sourceCapacity = positiveInteger(options.sourceCapacity, 1_024)
  }

  get current(): CatalogSnapshot | undefined {
    return this.#current
  }

  publish(snapshot: CatalogSnapshot): CatalogPublication {
    const previous = this.#current
    const previousRevisions = new Map(
      previous?.index.specs.map((entry) => [entry.source, entry.revision]) ?? [],
    )
    const nextSources = new Set(snapshot.index.specs.map((entry) => entry.source))
    const changedSpecs = snapshot.index.specs
      .filter((entry) => previousRevisions.get(entry.source) !== entry.revision)
      .map((entry) => entry.source)
    const removedSpecs = previous
      ? previous.index.specs
          .filter((entry) => !nextSources.has(entry.source))
          .map((entry) => entry.source)
      : []

    for (const [key, payload] of snapshot.specs) remember(this.#specs, key, payload)
    for (const [key, payload] of snapshot.sources) remember(this.#sources, key, payload)
    this.#current = snapshot
    this.#prune()

    return {
      changed: previous?.index.generation !== snapshot.index.generation,
      generation: snapshot.index.generation,
      changedSpecs,
      removedSpecs,
    }
  }

  spec(source: string, revision: string): CatalogSpecPayload | undefined {
    return recall(this.#specs, specPayloadKey(source, revision))
  }

  source(key: string): CatalogSourcePayload | undefined {
    return recall(this.#sources, key)
  }

  #prune(): void {
    const protectedSpecs = new Set(this.#current?.specs.keys() ?? [])
    const protectedSources = new Set(this.#current?.sources.keys() ?? [])
    prune(this.#specs, this.#specCapacity, protectedSpecs)
    prune(this.#sources, this.#sourceCapacity, protectedSources)
  }
}

function remember<Key, Value>(entries: Map<Key, Value>, key: Key, value: Value): void {
  entries.delete(key)
  entries.set(key, value)
}

function recall<Key, Value>(entries: Map<Key, Value>, key: Key): Value | undefined {
  const value = entries.get(key)
  if (value === undefined) return
  remember(entries, key, value)
  return value
}

function prune<Key, Value>(
  entries: Map<Key, Value>,
  capacity: number,
  protectedKeys: Set<Key>,
): void {
  if (entries.size <= capacity) return
  for (const key of entries.keys()) {
    if (entries.size <= capacity) return
    if (!protectedKeys.has(key)) entries.delete(key)
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback
}

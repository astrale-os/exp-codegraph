import type { Fact, FactHeader, FactShard, FactShardReference } from '../facts/index.ts'
import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts'
import type {
  AnalysisGenerationId,
  FactId,
  ProjectUniverseId,
  SnapshotSetId,
  SourceManifestId,
} from '../identity/index.ts'
import type {
  AnalysisQuery,
  AnalysisSnapshotSet,
  CapabilityStatus,
  FactFilter,
  FactHeaderPage,
  FactPage,
  PageRequest,
} from '../query/index.ts'
import { deriveAnalysisSnapshotSetId } from '../query/identity.ts'

import { factHeader, shardReference } from '../facts/index.ts'
import { TransactionError, validateFactTransaction } from '../generation/index.ts'
import { deriveAnalysisId } from '../identity/index.ts'
import { stableJson } from '../identity/model.ts'
import { MemoryFactIndex } from './query-index.ts'
import { matchesMaterializedManifest } from './manifest.ts'
import { bindPhysicalFact, immutableFact } from '../facts/representation/index.ts'

export interface MaterializedGeneration {
  readonly generation: AnalysisGeneration
  readonly shards: ReadonlyMap<string, FactShard>
}

export function materializeTransaction(
  current: MaterializedGeneration | undefined,
  transaction: FactTransaction,
): MaterializedGeneration {
  const diagnostics = [...validateFactTransaction(transaction, current?.generation.id)]
  const expectedSequence = (current?.generation.sequence ?? 0) + 1
  if (transaction.next.sequence !== expectedSequence) {
    diagnostics.push(
      `GENERATION_SEQUENCE_STALE:expected=${expectedSequence}:actual=${transaction.next.sequence}`,
    )
  }
  if (current && current.generation.universe !== transaction.next.universe) {
    diagnostics.push('GENERATION_UNIVERSE_MISMATCH')
  }
  if (diagnostics.length) {
    const code = diagnostics.includes('BASE_STALE') ? 'BASE_STALE' : 'TRANSACTION_ABORTED'
    throw new TransactionError(code, diagnostics.join('\n'))
  }

  const shards = new Map(current?.shards ?? [])
  for (const key of transaction.deletes) {
    if (!shards.delete(key))
      throw new TransactionError('MANIFEST_INVALID', `Unknown delete ${key}.`)
  }
  for (const shard of transaction.upserts) shards.set(shard.key, immutable(shard))
  if (!matchesMaterializedManifest(shards, transaction)) {
    throw new TransactionError(
      'MANIFEST_INVALID',
      'The transaction manifest is not the complete materialized next generation.',
    )
  }
  const facts = [...shards.values()].flatMap((shard) => shard.facts)
  const identities = new Set<FactId>()
  for (const fact of facts) {
    if (identities.has(fact.id)) {
      throw new TransactionError(
        'SHARD_INVALID',
        `Fact identity ${fact.id} occurs in more than one materialized shard.`,
      )
    }
    identities.add(fact.id)
  }
  for (const fact of facts) {
    for (const input of fact.provenance.inputs) {
      if (!identities.has(input)) {
        throw new TransactionError(
          'SHARD_INVALID',
          `Fact ${fact.id} names unavailable derivation input ${input}.`,
        )
      }
    }
  }
  // Shard digests deliberately omit the enclosing generation. Preserve the
  // immutable physical shard objects across generations and bind their facts
  // only when a generation-pinned reader observes them. Commit work therefore
  // scales with the delta rather than recreating every unaffected fact.
  const inherited = current instanceof MaterializedSnapshot ? current.indexedFacts() : undefined
  const removed = inherited ? [...new Set([...transaction.deletes, ...transaction.upserts.map((shard) => shard.key)])]
    .flatMap((key) => { const shard = current!.shards.get(key); return shard ? [shard] : [] }) : []
  return immutable(new MaterializedSnapshot(transaction.next, shards, inherited?.update(removed, transaction.upserts)))
}

export function serializeMaterialized(value: MaterializedGeneration): string {
  return stableJson({
    generation: value.generation,
    shards: [...value.shards.values()]
      .map((shard) => bindShard(shard, value.generation.id))
      .sort(byShardKey),
  })
}

export function parseMaterialized(value: string): MaterializedGeneration {
  const parsed = JSON.parse(value) as {
    readonly generation: AnalysisGeneration
    readonly shards: readonly FactShard[]
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.generation ||
    !Array.isArray(parsed.shards)
  ) {
    throw new TypeError('Persisted analysis snapshot has an invalid envelope.')
  }
  const manifest = parsed.shards.map(shardReference).sort(byKey)
  const transaction: FactTransaction = {
    protocolVersion: parsed.generation.producer.protocolVersion,
    next: parsed.generation,
    manifest,
    upserts: parsed.shards,
    deletes: [],
  }
  const diagnostics = [...validateFactTransaction(transaction)]
  const identities = new Set<FactId>()
  for (const shard of parsed.shards) {
    for (const fact of shard.facts) {
      if (identities.has(fact.id)) diagnostics.push(`FACT_ID_DUPLICATE:${fact.id}`)
      identities.add(fact.id)
    }
  }
  for (const shard of parsed.shards) {
    for (const fact of shard.facts) {
      for (const input of fact.provenance.inputs) {
        if (!identities.has(input)) diagnostics.push(`FACT_INPUT_UNAVAILABLE:${fact.id}:${input}`)
      }
    }
  }
  if (diagnostics.length) {
    throw new Error(
      `Persisted analysis snapshot failed semantic validation: ${[...new Set(diagnostics)].sort().join(', ')}`,
    )
  }
  return immutable(new MaterializedSnapshot(
    parsed.generation,
    new Map(parsed.shards.map((s) => [s.key, s])),
  ))
}

export function createQuery(
  materialized: MaterializedGeneration,
  release: () => void | Promise<void>,
): AnalysisQuery {
  return new PinnedQuery(materialized, release)
}

export function createSnapshotSet(
  values: ReadonlyMap<ProjectUniverseId, MaterializedGeneration>,
  inventory: SourceManifestId,
  open: (universe: ProjectUniverseId, generation: AnalysisGenerationId) => Promise<AnalysisQuery>,
  release: () => void | Promise<void>,
): AnalysisSnapshotSet {
  return new PinnedSnapshotSet(values, inventory, open, release)
}

/** Query indexes belong to the retained generation, never to a process-global cache. */
class MaterializedSnapshot implements MaterializedGeneration {
  #index: MemoryQueryIndex | undefined
  #facts: MemoryFactIndex | undefined
  readonly generation: AnalysisGeneration
  readonly shards: ReadonlyMap<string, FactShard>

  constructor(
    generation: AnalysisGeneration,
    shards: ReadonlyMap<string, FactShard>,
    facts?: MemoryFactIndex,
  ) {
    this.#facts = facts
    this.generation = generation
    this.shards = shards
  }

  queryIndex(): MemoryQueryIndex {
    return this.#index ??= new MemoryQueryIndex(this, this.#facts ??= MemoryFactIndex.build(this.shards))
  }

  indexedFacts(): MemoryFactIndex | undefined { return this.#facts }
}

class MemoryQueryIndex {
  readonly generation: AnalysisGeneration
  readonly #data: MemoryFactIndex
  readonly #facts = new Map<FactId, Fact>()
  readonly #headers = new Map<FactId, FactHeader>()
  #capabilities: readonly CapabilityStatus[] | undefined

  constructor(materialized: MaterializedGeneration, data = MemoryFactIndex.build(materialized.shards)) {
    this.generation = materialized.generation
    this.#data = data
  }

  get manifest(): readonly FactShardReference[] { return this.#data.manifest() }

  fact(input: FactId | Fact): Fact | undefined {
    const id = typeof input === 'string' ? input : input.id
    let value = this.#facts.get(id)
    if (!value) {
      const fact = typeof input === 'string' ? this.#data.facts.get(id) : input
      if (!fact) return
      value = immutableFact(bindFact(fact, this.generation.id))
      this.#facts.set(id, value)
    }
    return value
  }

  header(input: FactId | Fact): FactHeader | undefined {
    const id = typeof input === 'string' ? input : input.id
    let value = this.#headers.get(id)
    if (!value) {
      const fact = typeof input === 'string' ? this.#data.facts.get(id) : input
      if (!fact) return
      value = Object.freeze({ ...factHeader(fact), generation: this.generation.id })
      this.#headers.set(id, value)
    }
    return value
  }

  capabilities(): readonly CapabilityStatus[] {
    return this.#capabilities ??= immutable(this.#data.capabilities(this.generation.capabilities))
  }

  matching(filter: FactFilter): Iterable<Fact> { return this.#data.matching(filter) }

  page(filter: FactFilter, page: PageRequest): FactHeaderPage {
    const limit = page.limit
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError('Fact page limit must be an integer from 1 through 10000.')
    }
    const signature = filterSignature(filter)
    const start = page.cursor ? decodeCursor(page.cursor, this.generation.id, signature) : 0
    const headers: FactHeader[] = []
    let total = 0
    let hasNext = false
    for (const fact of this.matching(filter)) {
      const position = total++
      if (position < start) continue
      if (headers.length < limit) headers.push(this.header(fact)!)
      else { hasNext = true; if (!page.includeTotal) break }
    }
    return {
      headers,
      ...(hasNext ? { nextCursor: encodeCursor(this.generation.id, signature, start + headers.length) } : {}),
      ...(page.includeTotal ? { total } : {}),
    }
  }
}

class PinnedQuery implements AnalysisQuery {
  readonly generation: AnalysisGeneration
  readonly #index: MemoryQueryIndex
  readonly #release: () => void | Promise<void>
  #disposed = false

  constructor(materialized: MaterializedGeneration, release: () => void | Promise<void>) {
    this.generation = materialized.generation
    this.#release = release
    this.#index = materialized instanceof MaterializedSnapshot
      ? materialized.queryIndex()
      : new MemoryQueryIndex(materialized)
  }

  async manifest(): Promise<readonly FactShardReference[]> {
    this.assertOpen()
    return this.#index.manifest
  }

  async capabilities(): Promise<readonly CapabilityStatus[]> {
    this.assertOpen()
    return this.#index.capabilities()
  }

  async headers(filter: FactFilter = {}, page: PageRequest = { limit: 100 }): Promise<FactHeaderPage> {
    this.assertOpen()
    return this.#index.page(filter, page)
  }

  async headersById(ids: readonly FactId[]): Promise<readonly FactHeader[]> {
    this.assertOpen()
    return [...new Set(ids)].sort().flatMap((id) => {
      const header = this.#index.header(id)
      return header ? [header] : []
    })
  }

  async *exportHeaders(filter: FactFilter = {}): AsyncIterable<FactHeader> {
    this.assertOpen()
    for (const header of this.#index.matching(filter)) {
      this.assertOpen()
      yield this.#index.header(header)!
    }
  }

  async facts(filter: FactFilter = {}, page: PageRequest = { limit: 100 }): Promise<FactPage> {
    this.assertOpen()
    const result = this.#index.page(filter, page)
    return {
      facts: result.headers.map((header) => this.#index.fact(header.id)!),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result.total !== undefined ? { total: result.total } : {}),
    }
  }

  async factsById(ids: readonly FactId[]): Promise<readonly Fact[]> {
    this.assertOpen()
    return [...new Set(ids)].sort().flatMap((id) => {
      const fact = this.#index.fact(id)
      return fact ? [fact] : []
    })
  }

  async *export(filter: FactFilter = {}): AsyncIterable<Fact> {
    this.assertOpen()
    for (const header of this.#index.matching(filter)) {
      this.assertOpen()
      yield this.#index.fact(header)!
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#release()
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('Analysis query is disposed.')
  }
}

class PinnedSnapshotSet implements AnalysisSnapshotSet {
  readonly id: SnapshotSetId
  readonly inventory: SourceManifestId
  readonly generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>
  readonly universes: readonly ProjectUniverseId[]
  readonly #values: ReadonlyMap<ProjectUniverseId, MaterializedGeneration>
  readonly #openQuery: (
    universe: ProjectUniverseId,
    generation: AnalysisGenerationId,
  ) => Promise<AnalysisQuery>
  readonly #release: () => void | Promise<void>
  #disposed = false

  constructor(
    values: ReadonlyMap<ProjectUniverseId, MaterializedGeneration>,
    inventory: SourceManifestId,
    openQuery: (
      universe: ProjectUniverseId,
      generation: AnalysisGenerationId,
    ) => Promise<AnalysisQuery>,
    release: () => void | Promise<void>,
  ) {
    this.#values = values
    this.#openQuery = openQuery
    this.#release = release
    this.inventory = inventory
    this.universes = [...values.keys()].sort()
    this.generations = new Map(
      this.universes.map((universe) => [universe, values.get(universe)!.generation.id]),
    )
    this.id = deriveAnalysisSnapshotSetId(this.generations, inventory)
  }

  query(universe: ProjectUniverseId): Promise<AnalysisQuery> {
    if (this.#disposed) throw new Error('Analysis snapshot set is disposed.')
    const value = this.#values.get(universe)
    if (!value) throw new Error(`Universe ${universe} is not in this snapshot set.`)
    return this.#openQuery(universe, value.generation.id)
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

function filterSignature(filter: FactFilter): string {
  return deriveAnalysisId('fact', 'astrale.analysis.query-filter.v1', filter)
}

function encodeCursor(generation: AnalysisGenerationId, filter: string, index: number): string {
  return Buffer.from(stableJson({ generation, filter, index })).toString('base64url')
}

function decodeCursor(cursor: string, generation: AnalysisGenerationId, filter: string): number {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      generation: string
      filter: string
      index: number
    }
    if (
      decoded.generation !== generation ||
      decoded.filter !== filter ||
      !Number.isSafeInteger(decoded.index) ||
      decoded.index < 0
    ) {
      throw new Error()
    }
    return decoded.index
  } catch {
    throw new Error('Fact cursor is invalid or stale for this generation and filter.')
  }
}

function immutable<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (value instanceof Map) {
    for (const entry of value.values()) immutable(entry)
    return Object.freeze(value)
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (isFact(entry)) immutableFact(entry)
    else immutable(entry)
  }
  return Object.freeze(value)
}

function bindShard(shard: FactShard, generation: AnalysisGenerationId): FactShard {
  if (shard.facts.every((fact) => fact.generation === generation)) return shard
  return {
    ...shard,
    facts: shard.facts.map((fact) => bindFact(fact, generation)),
  }
}

function bindFact(fact: Fact, generation: AnalysisGenerationId): Fact {
  return bindPhysicalFact(fact, generation)
}

function isFact(value: unknown): value is Fact {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Partial<Fact>).id === 'string' &&
    typeof (value as Partial<Fact>).namespace === 'string' &&
    typeof (value as Partial<Fact>).generation === 'string' &&
    Object.hasOwn(value, 'payload'),
  )
}

function byKey(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

function byShardKey(left: FactShard, right: FactShard): number {
  return left.key.localeCompare(right.key)
}

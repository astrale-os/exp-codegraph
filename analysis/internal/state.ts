import type { Completeness, Fact, FactShard, FactShardReference } from '../facts/index.ts'
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
  FactPage,
  PageRequest,
} from '../query/index.ts'

import { shardReference } from '../facts/index.ts'
import { TransactionError, validateFactTransaction } from '../generation/index.ts'
import { deriveAnalysisId } from '../identity/index.ts'
import { stableJson } from '../identity/model.ts'
import { combineCompleteness } from './completeness.ts'

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
  const actual = [...shards.values()].map(shardReference).sort(byKey)
  if (stableJson(actual) !== stableJson(transaction.manifest)) {
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
  return immutable({ generation: transaction.next, shards })
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
  return immutable({
    generation: parsed.generation,
    shards: new Map(parsed.shards.map((s) => [s.key, s])),
  })
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

class PinnedQuery implements AnalysisQuery {
  readonly generation: AnalysisGeneration
  readonly #facts: readonly Fact[]
  readonly #byId: ReadonlyMap<FactId, Fact>
  readonly #manifest: readonly FactShardReference[]
  readonly #shardCompletion: readonly [string, Completeness, readonly string[]][]
  readonly #namespaceCapabilities: ReadonlyMap<string, readonly string[]>
  readonly #release: () => void | Promise<void>
  #disposed = false

  constructor(
    materialized: MaterializedGeneration,
    release: () => void | Promise<void>,
  ) {
    this.#release = release
    this.generation = materialized.generation
    this.#facts = [...materialized.shards.values()]
      .flatMap((shard) => shard.facts.map((fact) => bindFact(fact, materialized.generation.id)))
      .sort((left, right) => left.id.localeCompare(right.id))
    this.#byId = new Map(this.#facts.map((fact) => [fact.id, fact]))
    this.#manifest = [...materialized.shards.values()].map(shardReference).sort(byKey)
    this.#shardCompletion = [...materialized.shards.values()].map((shard) => [
      shard.namespace,
      shard.completion,
      shard.capabilities ?? [],
    ])
    const capabilities = new Map<string, Set<string>>()
    for (const shard of materialized.shards.values()) {
      const values = capabilities.get(shard.namespace) ?? new Set<string>()
      for (const capability of shard.capabilities ?? []) values.add(capability)
      capabilities.set(shard.namespace, values)
    }
    this.#namespaceCapabilities = new Map(
      [...capabilities].map(([namespace, values]) => [namespace, [...values].sort()]),
    )
  }

  async manifest(): Promise<readonly FactShardReference[]> {
    this.assertOpen()
    return this.#manifest
  }

  async capabilities(): Promise<readonly CapabilityStatus[]> {
    this.assertOpen()
    const completion = new Map<string, Completeness>()
    for (const capability of this.generation.capabilities)
      completion.set(capability, { kind: 'complete' })
    for (const [namespace, value, capabilities] of this.#shardCompletion) {
      completion.set(namespace, combineCompleteness(completion.get(namespace), value))
      for (const capability of capabilities) {
        completion.set(capability, combineCompleteness(completion.get(capability), value))
      }
    }
    for (const fact of this.#facts) {
      const current = completion.get(fact.namespace)
      completion.set(fact.namespace, combineCompleteness(current, fact.completeness))
      for (const capability of this.#namespaceCapabilities.get(fact.namespace) ?? []) {
        completion.set(
          capability,
          combineCompleteness(completion.get(capability), fact.completeness),
        )
      }
    }
    return [...completion]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([capability, value]) => ({ capability, completeness: value }))
  }

  async facts(filter: FactFilter = {}, page: PageRequest = { limit: 100 }): Promise<FactPage> {
    this.assertOpen()
    const limit = page.limit
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError('Fact page limit must be an integer from 1 through 10000.')
    }
    const signature = filterSignature(filter)
    const start = page.cursor ? decodeCursor(page.cursor, this.generation.id, signature) : 0
    const matching = this.#facts.filter((fact) => matches(fact, filter))
    const facts = matching.slice(start, start + limit)
    const next = start + facts.length
    return {
      facts,
      ...(next < matching.length
        ? { nextCursor: encodeCursor(this.generation.id, signature, next) }
        : {}),
      total: matching.length,
    }
  }

  async factsById(ids: readonly FactId[]): Promise<readonly Fact[]> {
    this.assertOpen()
    return [...new Set(ids)].sort().flatMap((id) => {
      const fact = this.#byId.get(id)
      return fact ? [fact] : []
    })
  }

  async *export(filter: FactFilter = {}): AsyncIterable<Fact> {
    this.assertOpen()
    for (const fact of this.#facts) {
      this.assertOpen()
      if (matches(fact, filter)) yield fact
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
    this.id = deriveAnalysisId(
      'snapshot-set',
      'astrale.analysis.snapshot-set.v2',
      {
        inventory,
        generations: this.universes.map((universe) => [
          universe,
          values.get(universe)!.generation.id,
        ]),
      },
    )
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

function matches(fact: Fact, filter: FactFilter): boolean {
  if (filter.namespaces && !filter.namespaces.includes(fact.namespace)) return false
  if (filter.kinds && !filter.kinds.includes(fact.kind)) return false
  if (filter.subjects && !filter.subjects.includes(fact.subject)) return false
  if (filter.completeness && !filter.completeness.includes(fact.completeness.kind)) return false
  if (
    filter.sources &&
    !fact.provenance.evidence.some((evidence) => filter.sources!.includes(evidence.source))
  ) {
    return false
  }
  if (filter.symbols && !filter.symbols.some((symbol) => fact.subject === symbol)) return false
  return true
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
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry)
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
  return fact.generation === generation ? fact : { ...fact, generation }
}

function byKey(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

function byShardKey(left: FactShard, right: FactShard): number {
  return left.key.localeCompare(right.key)
}

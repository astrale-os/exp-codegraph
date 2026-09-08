import { describe, expect, it } from 'vitest'
import { OrderedMap, compareKeys } from '../analysis/internal/ordered-map.ts'
import { MemoryFactIndex } from '../analysis/internal/query-index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { createQuery, parseMaterialized, serializeMaterialized, materializeTransaction } from '../analysis/internal/state.ts'
import { combineCompleteness, deriveAnalysisId, factShardDigest, generationIdentity, shardReference,
  type Fact, type FactFilter, type FactShard, type FactTransaction, type Completeness } from '../analysis/index.ts'

describe('persistent memory query data', () => {
  it('keeps sorted maps exact under adversarial order, deletions, replacement and pinned roots', () => {
    let table = new OrderedMap<number>()
    const expected = new Map<string, number>()
    for (let index = 0; index < 2_048; index++) {
      const key = String(index).padStart(6, '0')
      table = table.set(key, index); expected.set(key, index)
    }
    const pinned = table
    for (let index = 2_047; index >= 0; index--) {
      const key = String(index).padStart(6, '0')
      if (index % 3) { table = table.delete(key); expected.delete(key) }
      else { table = table.set(key, -index); expected.set(key, -index) }
    }
    table = table.set('é', 1).set('e\u0301', 2)
    expected.set('é', 1); expected.set('e\u0301', 2)
    expect([...table]).toEqual([...expected].sort(([left], [right]) => compareKeys(left, right)))
    expect(table.size).toBe(expected.size)
    for (const [key, value] of expected) expect(table.get(key)).toBe(value)
    expect([...pinned.values()]).toEqual(Array.from({ length: 2_048 }, (_, index) => index))
    expect(table.delete('absent')).toBe(table)
    for (const key of expected.keys()) table = table.delete(key)
    expect(table.size).toBe(0)
    expect([...table]).toEqual([])
    expected.clear()
    let random = 12345
    for (let index = 0; index < 2_048; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      const key = String(random % 251)
      if (random & 256) { table = table.set(key, index); expected.set(key, index) }
      else { table = table.delete(key); expected.delete(key) }
      if (index % 128 === 0) expect([...table]).toEqual([...expected].sort(([left], [right]) => compareKeys(left, right)))
    }
    expect([...table]).toEqual([...expected].sort(([left], [right]) => compareKeys(left, right)))
  })

  it('touches only replaced rows even when namespace and source postings contain the full project', () => {
    let reads = 0
    const rows = Array.from({ length: 10_000 }, (_, index) => new Proxy(fact(index), {
      get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver) },
    }))
    const shards = rows.map((row, index) => shard(index, [row], false))
    const before = MemoryFactIndex.build(new Map(shards.map((shard) => [shard.key, shard])))
    expect([...before.matching({ namespaces: ['fixture.values'], sources: [source('shared')] })]).toHaveLength(10_000)
    const removed = shards.slice(0, 4)
    const added = removed.map((old, index) => ({ ...old, facts: [{ ...fact(index), kind: 'edited' }] }))
    reads = 0
    const after = before.update(removed, added)
    expect(reads).toBeLessThan(500)
    expect(after.facts.size).toBe(10_000)
    expect([...after.matching({ kinds: ['edited'] })]).toEqual(added.flatMap((shard) => shard.facts).sort((a, b) => compareKeys(a.id, b.id)))
    expect([...before.matching({ kinds: ['edited'] })]).toEqual([])
    expect(after.facts.get(rows[9999]!.id)).toBe(before.facts.get(rows[9999]!.id))
  })

  it('maintains generation bindings, overlapping postings, pagination and completeness through deltas and restart', async () => {
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
    const initialShards = Array.from({ length: 24 }, (_, index) => shard(index, [fact(index)], true,
      index % 2 ? [] : ['fixture.semantic']))
    let transaction = transactionFor(initialShards)
    let materialized = materializeTransaction(undefined, transaction)
    await store.commit(transaction)
    const pinned = await store.open(transaction.next.universe)
    const original = await observe(pinned)
    const filter: FactFilter = { namespaces: ['fixture.values'], sources: [source('shared'), source('1')] }
    // Build the postings before the first delta; later snapshots must update them.
    await pinned.headers(filter)
    const cursor = (await pinned.headers({}, { limit: 1 })).nextCursor!
    try {
      for (let iteration = 0; iteration < 8; iteration++) {
        const old = materialized.shards.get(initialShards[iteration]!.key)!
        const row = old.facts[0]!
        const replacement = shard(iteration, [{ ...row, namespace: iteration % 2 ? 'fixture.other' : row.namespace,
          kind: iteration % 3 ? 'edited' : row.kind, subject: subject(iteration + 100),
          completeness: iteration === 2 ? unavailable : iteration === 4 ? partial : { kind: 'complete' },
          provenance: { ...row.provenance, evidence: [{ source: source(`changed-${iteration}`),
            revision: deriveAnalysisId('source-revision', 'delta-test', { iteration }), start: 0, end: 1 }] },
          payload: { iteration },
        }], true, iteration % 2 ? ['fixture.second'] : [])
        transaction = transactionFor([replacement], transaction, [...materialized.shards.values()])
        materialized = materializeTransaction(materialized, transaction)
        await store.commit(transaction)
        const current = await store.open(transaction.next.universe)
        const restarted = createQuery(parseMaterialized(serializeMaterialized(materialized)), () => {})
        try {
          expect(await observe(current)).toEqual(await observe(restarted))
          expect(await current.capabilities()).toEqual(referenceCapabilities(materialized))
          expect(await observe(pinned)).toEqual(original)
          await expect(current.headers({}, { limit: 1, cursor })).rejects.toThrow('stale')
          const filtered = []
          let next: string | undefined
          do {
            const page = await current.headers(filter, { limit: 3, includeTotal: true, ...(next ? { cursor: next } : {}) })
            const expected = []
            for await (const header of restarted.exportHeaders(filter)) expected.push(header.id)
            expect(page.total).toBe(expected.length)
            filtered.push(...page.headers.map((header) => header.id)); next = page.nextCursor
            if (!next) expect(filtered).toEqual(expected)
          } while (next)
        } finally { await current.dispose(); await restarted.dispose() }
      }
      // Remove the unavailable contributor: its formerly masked partial sibling must reappear.
      const unavailableKey = initialShards[2]!.key
      transaction = transactionFor([], transaction, [...materialized.shards.values()], [unavailableKey])
      materialized = materializeTransaction(materialized, transaction)
      await store.commit(transaction)
      const current = await store.open(transaction.next.universe)
      try {
        expect((await current.capabilities()).find(({ capability }) => capability === 'fixture.values')?.completeness).toEqual(partial)
        expect(await current.capabilities()).toEqual(referenceCapabilities(materialized))
        const restarted = createQuery(parseMaterialized(serializeMaterialized(materialized)), () => {})
        try { expect(await observe(current)).toEqual(await observe(restarted)) } finally { await restarted.dispose() }
      } finally { await current.dispose() }
    } finally { await pinned.dispose(); await store.dispose() }
  })

  it('publishes no query data after rejected or cancelled commits, and releases old leases', async () => {
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
    const first = transactionFor([shard(0, [fact(0)]), shard(1, [fact(1)])])
    await store.commit(first)
    const pinned = await store.open(first.next.universe)
    const before = await observe(pinned)
    const duplicate = shard(2, [fact(0)])
    const rejected = transactionFor([duplicate], first, first.upserts)
    try {
      await expect(store.commit(rejected)).rejects.toThrow('more than one')
      expect(await store.current(first.next.universe)).toEqual(first.next)
      const valid = transactionFor([shard(0, [{ ...fact(0), payload: { changed: true } }])], first, first.upserts)
      const signal = AbortSignal.abort(new Error('cancelled fixture'))
      await expect(store.commit(valid, { signal })).rejects.toThrow('cancelled fixture')
      expect(await observe(pinned)).toEqual(before)
      await store.commit(valid)
      expect(await observe(pinned)).toEqual(before)
      await pinned.dispose()
      await expect(store.open(first.next.universe, first.next.id)).rejects.toThrow()
      const current = await store.open(first.next.universe)
      await current.dispose()
      await expect(current.factsById([fact(0).id])).rejects.toThrow('disposed')
    } finally { await pinned.dispose(); await store.dispose() }
  })
})

const partial: Completeness = { kind: 'partial', reasons: [{ code: 'PARTIAL', message: 'Partial fixture.', effective: {} }] }
const unavailable: Completeness = { kind: 'unavailable', reasons: [{ code: 'UNAVAILABLE', message: 'Unavailable fixture.', retryable: false }] }
function source(name: string) { return deriveAnalysisId('source', 'delta-test', { name }) }
function subject(index: number) { return deriveAnalysisId('symbol', 'delta-test', { index }) }
function fact(index: number): Fact {
  return { id: deriveAnalysisId('fact', 'delta-test', { index }),
    generation: deriveAnalysisId('generation', 'delta-test-pending', {}), namespace: 'fixture.values', schemaVersion: 1,
    kind: 'value', subject: subject(index), completeness: { kind: 'complete' },
    provenance: { pass: deriveAnalysisId('pass', 'delta-test', {}), passVersion: '1', inputs: [],
      evidence: [source('shared'), source(String(index % 3)), source('shared')].map((source) => ({ source,
        revision: deriveAnalysisId('source-revision', source, {}), start: 0, end: 1 })) }, payload: { index } }
}
function shard(index: number, facts: readonly Fact[], digest = true, capabilities: readonly string[] = []): FactShard {
  const value = { key: deriveAnalysisId('fact-shard-key', 'delta-test', { index }), namespace: facts[0]!.namespace,
    schemaVersion: 1, completion: { kind: 'complete' as const }, facts: [...facts].sort((a, b) => compareKeys(a.id, b.id)), capabilities }
  return { ...value, digest: digest ? factShardDigest(value) : deriveAnalysisId('fact-shard-digest', 'delta-test', { index }) }
}
function transactionFor(upserts: readonly FactShard[], previous?: FactTransaction, base: readonly FactShard[] = [], deletes: readonly FactShard['key'][] = []): FactTransaction {
  const shards = new Map(base.map((shard) => [shard.key, shard]))
  for (const key of deletes) shards.delete(key)
  for (const shard of upserts) shards.set(shard.key, shard)
  const manifest = [...shards.values()].map(shardReference).sort((a, b) => compareKeys(a.key, b.key))
  const identity = { universe: deriveAnalysisId('project-universe', 'delta-test', {}),
    sourceManifest: deriveAnalysisId('source-manifest', 'delta-test', { sequence: previous?.next.sequence ?? 0 }),
    capabilities: ['fixture.semantic', 'fixture.values'], producer: { id: deriveAnalysisId('producer', 'delta-test', {}),
      name: 'fixture', version: '1', protocolVersion: 1 } }
  const id = generationIdentity(identity, manifest)
  return { protocolVersion: 1, ...(previous ? { base: previous.next.id } : {}),
    next: { ...identity, id, sequence: (previous?.next.sequence ?? 0) + 1 }, manifest, deletes,
    upserts: [...upserts].sort((a, b) => compareKeys(a.key, b.key)).map((shard) => ({ ...shard, facts: shard.facts.map((fact) => ({ ...fact, generation: id })) })) }
}
async function observe(query: import('../analysis/query/index.ts').AnalysisQuery) {
  const facts = []
  const headers = []
  for await (const fact of query.export()) facts.push(fact)
  for await (const header of query.exportHeaders()) headers.push(header)
  return { facts, headers, manifest: await query.manifest(), capabilities: await query.capabilities() }
}

function referenceCapabilities(materialized: import('../analysis/internal/state.ts').MaterializedGeneration) {
  const completion = new Map<string, Completeness>(materialized.generation.capabilities.map((value) => [value, { kind: 'complete' }]))
  const namespaceCapabilities = new Map<string, Set<string>>()
  for (const shard of materialized.shards.values()) {
    const values = namespaceCapabilities.get(shard.namespace) ?? new Set<string>()
    for (const capability of shard.capabilities ?? []) values.add(capability)
    namespaceCapabilities.set(shard.namespace, values)
    for (const capability of [shard.namespace, ...shard.capabilities ?? []]) completion.set(capability,
      combineCompleteness(completion.get(capability), shard.completion))
  }
  for (const shard of materialized.shards.values()) for (const fact of shard.facts) {
    for (const capability of [fact.namespace, ...namespaceCapabilities.get(fact.namespace) ?? []]) completion.set(capability,
      combineCompleteness(completion.get(capability), fact.completeness))
  }
  return [...completion].sort(([left], [right]) => left.localeCompare(right)).map(([capability, completeness]) => ({ capability, completeness }))
}

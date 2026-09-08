import { describe, expect, it, vi } from 'vitest'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import {
  deriveAnalysisId, factShardDigest, generationIdentity, shardReference,
  type Fact, type FactFilter, type FactShard, type FactTransaction,
} from '../analysis/index.ts'

const work = vi.hoisted(() => ({ headers: 0, fields: 0 }))

vi.mock('../analysis/facts/index.ts', async (original) => {
  const actual = await original<typeof import('../analysis/facts/index.ts')>()
  return {
    ...actual,
    factHeader(fact: Fact) {
      work.headers++
      return new Proxy(actual.factHeader(fact), {
        get(target, key, receiver) {
          if (['namespace', 'subject', 'kind', 'completeness', 'provenance'].includes(String(key))) work.fields++
          return Reflect.get(target, key, receiver)
        },
      })
    },
  }
})

describe('memory generation query ownership', () => {
  it('binds only requested envelopes once across leases and bounds selective reads by their candidates', async () => {
    const transaction = corpus(5_000)
    const store = createMemoryAnalysisStore()
    try {
      await store.commit(transaction)
      work.headers = 0
      const retained = await store.open(transaction.next.universe)
      expect(work.headers).toBe(0)
      work.fields = 0
      await retained.headers({ subjects: [subject(0)] }, { limit: 1 })
      expect(work.fields).toBeLessThan(5_010)
      work.fields = 0
      for (let index = 0; index < 32; index++) {
        const query = await store.open(transaction.next.universe)
        const page = await query.headers({ subjects: [subject(index)] }, { limit: 1 })
        expect(page.headers).toHaveLength(1)
        const facts = await query.facts({ subjects: [subject(index)] }, { limit: 1 })
        expect(facts.facts.map((fact) => fact.id)).toEqual(page.headers.map((header) => header.id))
        await query.dispose()
        await expect(query.headers()).rejects.toThrow('disposed')
      }
      expect(work.headers).toBe(32)
      expect(work.fields).toBeLessThan(256)
      expect((await retained.headers({ subjects: [subject(0)] })).headers).toHaveLength(1)
      await retained.dispose()
    } finally { await store.dispose() }
  })

  it('keeps pagination, totals, overlapping source selection and empty filters exact', async () => {
    const transaction = corpus(80)
    const store = createMemoryAnalysisStore()
    try {
      await store.commit(transaction)
      const query = await store.open(transaction.next.universe)
      try {
        const filter: FactFilter = {
          namespaces: ['fixture.left'],
          sources: [source('shared'), source('0'), source('shared')],
          kinds: ['value'],
          completeness: ['complete'],
        }
        const expected = transaction.upserts.flatMap((shard) => shard.facts)
          .filter((fact) => fact.namespace === 'fixture.left' && fact.completeness.kind === 'complete')
          .map((fact) => fact.id).sort()
        const actual = []
        let cursor: string | undefined
        do {
          const page = await query.headers(filter, { limit: 7, includeTotal: true, ...(cursor ? { cursor } : {}) })
          expect(page.total).toBe(expected.length)
          actual.push(...page.headers.map((header) => header.id))
          cursor = page.nextCursor
        } while (cursor)
        expect(actual).toEqual(expected)
        const exported = []
        for await (const fact of query.export(filter)) exported.push(fact.id)
        expect(exported).toEqual(expected)
        const overlapping = []
        for await (const header of query.exportHeaders({ sources: [source('even'), source('0')] })) overlapping.push(header.id)
        expect(overlapping).toEqual(transaction.upserts.flatMap((shard) => shard.facts)
          .filter((fact) => fact.namespace === 'fixture.left').map((fact) => fact.id).sort())
        for (const key of ['subjects', 'sources', 'namespaces', 'symbols', 'kinds', 'completeness'] as const) {
          expect(await query.headers({ [key]: [] }, { limit: 1, includeTotal: true })).toEqual({ headers: [], total: 0 })
        }
        const selected = await query.facts({ symbols: [subject(2)] })
        expect(selected.facts).toHaveLength(1)
        expect(selected.facts[0]!.subject).toBe(subject(2))
      } finally { await query.dispose() }
    } finally { await store.dispose() }
  })

  it('evicts old universes only when opted in and preserves query and snapshot-set leases', async () => {
    const [first, second, third, fourth] = ['first', 'second', 'third', 'fourth'].map((name) => corpus(20, undefined, name))
    const store = createMemoryAnalysisStore({ maximumRetainedUniverses: 2 })
    const shared = createMemoryAnalysisStore()
    try {
      for (const transaction of [first!, second!, third!, fourth!]) await shared.commit(transaction)
      for (const transaction of [first!, second!, third!, fourth!]) expect(await shared.current(transaction.next.universe)).toEqual(transaction.next)
      await store.commit(first!)
      const pinned = await store.open(first!.next.universe)
      await store.commit(second!)
      const set = await store.snapshotSet(new Map([[second!.next.universe, second!.next.id]]), second!.next.sourceManifest)
      const child = await set.query(second!.next.universe)
      await store.commit(third!)
      expect(await store.current(first!.next.universe)).toEqual(first!.next)
      expect((await pinned.facts()).facts).toHaveLength(20)
      await pinned.dispose()
      expect(await store.current(first!.next.universe)).toBeUndefined()
      await set.dispose()
      await store.commit(fourth!)
      expect((await child.facts()).facts).toHaveLength(20)
      expect(await store.current(second!.next.universe)).toEqual(second!.next)
      await child.dispose()
      await store.commit(corpus(20, undefined, 'fifth'))
      // The current() observations above did not promote the historical universe.
      expect(await store.current(second!.next.universe)).toBeUndefined()
      expect(await store.current(fourth!.next.universe)).toEqual(fourth!.next)
      await expect(store.open(first!.next.universe, first!.next.id)).rejects.toThrow()
    } finally { await store.dispose(); await shared.dispose() }
    for (const maximumRetainedUniverses of [0, -1, 1.5, Infinity]) {
      expect(() => createMemoryAnalysisStore({ maximumRetainedUniverses })).toThrow('maximumRetainedUniverses')
    }
  })

  it('keeps generation bindings and leases isolated when unchanged fact identities are reused', async () => {
    const first = corpus(80)
    const second = corpus(80, first)
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
    try {
      await store.commit(first)
      const original = await store.open(first.next.universe)
      await store.commit(second)
      const current = await store.open(second.next.universe)
      try {
        const before = (await original.facts({ subjects: [subject(0)] })).facts[0]!
        const after = (await current.facts({ subjects: [subject(0)] })).facts[0]!
        expect(before.id).toBe(after.id)
        expect(before.generation).toBe(first.next.id)
        expect(after.generation).toBe(second.next.id)
        expect(before.payload).toEqual({ value: 0 })
        expect(after.payload).toEqual({ value: 'edited' })
        const beforePage = await original.headers({}, { limit: 1 })
        await expect(current.headers({}, { limit: 1, cursor: beforePage.nextCursor })).rejects.toThrow('stale')
        expect(Object.isFrozen(after)).toBe(true)
        expect(Object.isFrozen((await current.headersById([after.id]))[0])).toBe(true)
        await original.dispose()
        await expect(store.open(first.next.universe, first.next.id)).rejects.toThrow()
        expect((await current.facts({ subjects: [subject(0)] })).facts[0]!.payload).toEqual({ value: 'edited' })
      } finally { await original.dispose(); await current.dispose() }
    } finally { await store.dispose() }
  })
})

function source(name: string) { return deriveAnalysisId('source', 'memory-query-test', { name }) }
function subject(index: number) { return deriveAnalysisId('symbol', 'memory-query-test', { index }) }

function corpus(size: number, previous?: FactTransaction, universeName = 'default'): FactTransaction {
  const partial = {
    kind: 'partial' as const,
    reasons: [{ code: 'FIXTURE_PARTIAL', message: 'Selected fixture evidence is partial.', effective: {} }],
  }
  const sequence = previous ? previous.next.sequence + 1 : 1
  const universe = deriveAnalysisId('project-universe', 'memory-query-test', { universeName })
  const producer = {
    id: deriveAnalysisId('producer', 'memory-query-test', {}),
    name: 'memory-query-test', version: '1', protocolVersion: 1,
  }
  const generation = deriveAnalysisId('generation', 'memory-query-test-pending', { sequence })
  const groups = new Map<string, Fact[]>()
  for (let index = 0; index < size; index++) {
    const namespace = index % 2 === 0 ? 'fixture.left' : 'fixture.right'
    const evidence = [source(String(index % 20)), source('shared'), source('shared'), ...(index % 2 === 0 ? [source('even')] : [])].map((source) => ({
      source, revision: deriveAnalysisId('source-revision', source, {}), start: 0, end: 1,
    }))
    const fact: Fact = {
      id: deriveAnalysisId('fact', namespace, { index }), generation, namespace, schemaVersion: 1,
      kind: 'value', subject: subject(index),
      completeness: index % 17 === 0 ? partial : { kind: 'complete' },
      provenance: { pass: deriveAnalysisId('pass', namespace, {}), passVersion: '1', evidence, inputs: [] },
      payload: { value: previous && index === 0 ? 'edited' : index },
    }
    const facts = groups.get(namespace) ?? []
    facts.push(fact)
    groups.set(namespace, facts)
  }
  const shards: FactShard[] = [...groups].map(([namespace, facts]) => {
    const draft = {
      key: deriveAnalysisId('fact-shard-key', namespace, {}), namespace, schemaVersion: 1,
      completion: partial, facts: facts.sort((left, right) => left.id.localeCompare(right.id)),
    }
    return { ...draft, digest: factShardDigest(draft) }
  }).sort((left, right) => left.key.localeCompare(right.key))
  const manifest = shards.map(shardReference)
  const identity = {
    universe, producer, capabilities: [...groups.keys()].sort(),
    sourceManifest: deriveAnalysisId('source-manifest', 'memory-query-test', { sequence }),
  }
  const id = generationIdentity(identity, manifest)
  return {
    protocolVersion: 1, ...(previous ? { base: previous.next.id } : {}),
    next: { ...identity, id, sequence }, manifest, deletes: [],
    upserts: shards.map((shard) => ({ ...shard, facts: shard.facts.map((fact) => ({ ...fact, generation: id })) })),
  }
}

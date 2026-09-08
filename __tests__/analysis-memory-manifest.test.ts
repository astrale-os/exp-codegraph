import { describe, expect, it, vi } from 'vitest'
import { matchesMaterializedManifest } from '../analysis/internal/manifest.ts'
import { materializeTransaction } from '../analysis/internal/state.ts'
import { stableJson } from '../analysis/identity/model.ts'
import { deriveAnalysisId, factShardDigest, generationIdentity, shardReference, type Fact,
  type FactShard, type FactShardReference, type FactTransaction } from '../analysis/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'

describe('memory manifest admission', () => {
  it('compares complete ordinary manifests without canonical JSON graphs or strings', () => {
    const shards = Array.from({ length: 2_048 }, (_, index) => fixtureShard(index))
    const catalogue = new Map(shards.map((shard) => [shard.key, shard]))
    const manifest = shards.map((shard) => Object.freeze(shardReference(shard))).sort((a, b) => a.key.localeCompare(b.key))
    const entries = vi.spyOn(Object, 'entries')
    try {
      expect(matchesMaterializedManifest(catalogue, { manifest })).toBe(true)
      expect(matchesMaterializedManifest(catalogue, { manifest: [...manifest] })).toBe(true)
      expect(entries).not.toHaveBeenCalled()
    } finally { entries.mockRestore() }
    for (const replacement of [manifest.slice(1), [...manifest, manifest[0]!], [...manifest].reverse(),
      manifest.map((entry, index) => index === 0 ? { ...entry, digest: id('fact-shard-digest', 'different') } : entry)]) {
      expect(matchesMaterializedManifest(catalogue, { manifest: replacement })).toBe(original(catalogue, { manifest: replacement }))
      expect(matchesMaterializedManifest(catalogue, { manifest: replacement })).toBe(false)
    }
  })

  it('preserves extra fields, optional capabilities and mutable nested data', () => {
    for (const capabilities of [undefined, [], ['fixture.a', 'fixture.b']]) {
      const shard = fixtureShard(0, capabilities)
      const shards = new Map([[shard.key, shard]])
      const reference = shardReference(shard)
      const variants = [reference, { ...reference, capabilities: undefined }, { ...reference, extra: undefined },
        { ...reference, extra: 1 }, { ...reference, extra: 3n }, { ...reference, extra: { nested: 'value' } },
        Object.assign(Object.create(null), reference), { ...reference, facts: NaN }, { ...reference, facts: Infinity }]
      for (const entry of variants) {
        const transaction = { manifest: [entry] }
        expect(matchesMaterializedManifest(shards, transaction)).toBe(original(shards, transaction))
      }
      const values = [...capabilities ?? []]
      const mutable = { ...reference, capabilities: values }
      const frozen = Object.freeze({ ...mutable })
      for (const entry of [mutable, frozen]) {
        const transaction = { manifest: [entry] }
        expect(matchesMaterializedManifest(shards, transaction)).toBe(original(shards, transaction))
        values.push('changed')
        expect(matchesMaterializedManifest(shards, transaction)).toBe(original(shards, transaction))
        values.pop()
        expect(matchesMaterializedManifest(shards, transaction)).toBe(original(shards, transaction))
      }
      Object.defineProperty(values, 'every', { get() { throw new Error('An unrelated array property must not be observed.') } })
      expect(matchesMaterializedManifest(shards, { manifest: [mutable] })).toBe(original(shards, { manifest: [mutable] }))
    }
  })

  it('keeps custom accessor and toJSON observations in the old order', () => {
    const observations: string[] = []
    const plain = fixtureShard(0, ['fixture.a'])
    const reference = shardReference(plain)
    const shard = { ...plain, get namespace() { observations.push('shard.namespace'); return plain.namespace } }
    const shards = new Map([[shard.key, shard]])
    const variants = [
      { ...reference, get namespace() { observations.push('reference.namespace'); return reference.namespace } },
      { ...reference, get extra() { observations.push('reference.extra'); return undefined } },
      { ...reference, toJSON(key: string) { observations.push(`reference.toJSON:${key}`); return reference } },
      new Proxy(reference, { get(target, key, receiver) { observations.push(`proxy.get:${String(key)}`); return Reflect.get(target, key, receiver) } }),
    ]
    for (const entry of variants) {
      const transaction = { get manifest() { observations.push('transaction.manifest'); return [entry] } }
      observations.length = 0
      const expected = original(shards, transaction)
      const order = [...observations]
      observations.length = 0
      expect(matchesMaterializedManifest(shards, transaction)).toBe(expected)
      expect(observations).toEqual(order)
      // Exercise reference preflight too, with ordinary surrounding data.
      const ordinary = new Map([[plain.key, plain]])
      observations.length = 0
      const expectedReference = original(ordinary, { manifest: [entry] })
      const referenceOrder = [...observations]
      observations.length = 0
      expect(matchesMaterializedManifest(ordinary, { manifest: [entry] })).toBe(expectedReference)
      expect(observations).toEqual(referenceOrder)
    }
  })

  it('rechecks inherited optional fields after certifying a frozen record', () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'capabilities')
    const observations: string[] = []
    try {
      delete (Object.prototype as { capabilities?: unknown }).capabilities
      const shard = fixtureShard(0)
      const reference = Object.freeze(shardReference(shard))
      const shards = new Map([[shard.key, shard]])
      const transaction = { manifest: [reference] }
      expect(matchesMaterializedManifest(shards, transaction)).toBe(true)
      for (const descriptor of [
        { value: Object.freeze(['inherited']), configurable: true },
        { get() { observations.push('inherited.capabilities'); return ['inherited'] }, configurable: true },
      ]) {
        Object.defineProperty(Object.prototype, 'capabilities', descriptor)
        observations.length = 0
        const expected = original(shards, transaction)
        const order = [...observations]
        observations.length = 0
        expect(expected).toBe(false)
        expect(matchesMaterializedManifest(shards, transaction)).toBe(expected)
        expect(observations).toEqual(order)
      }
      delete (Object.prototype as { capabilities?: unknown }).capabilities
      expect(matchesMaterializedManifest(shards, transaction)).toBe(true)
      // A shard with an explicit own value must not hide a now-unsafe cached
      // reference whose optional field was absent when first certified.
      const explicit = Object.freeze({ ...shard, capabilities: undefined })
      const explicitShards = new Map([[shard.key, explicit]])
      expect(matchesMaterializedManifest(explicitShards, transaction)).toBe(true)
      Object.defineProperty(Object.prototype, 'capabilities', {
        get() { throw new Error('An inherited reference field must not be read.') }, configurable: true,
      })
      expect(matchesMaterializedManifest(explicitShards, transaction)).toBe(original(explicitShards, transaction))
    } finally {
      if (previous) Object.defineProperty(Object.prototype, 'capabilities', previous)
      else delete (Object.prototype as { capabilities?: unknown }).capabilities
    }
  })

  it('retains custom manifest array mapping, holes and inherited fields', () => {
    const shard = fixtureShard(0)
    const reference = shardReference(shard)
    const shards = new Map([[shard.key, shard]])
    const observations: string[] = []
    const custom = [reference]
    Object.defineProperty(custom, 'map', { value(callback: (value: FactShardReference, index: number) => unknown) {
      observations.push('manifest.map'); return [callback(reference, 0)]
    } })
    const accessor = [reference]
    Object.defineProperty(accessor, '0', { get() { observations.push('manifest[0]'); return reference } })
    for (const manifest of [custom, accessor, new Array<FactShardReference>(1), [Object.create(reference)]]) {
      observations.length = 0
      const expected = original(shards, { manifest })
      const order = [...observations]
      observations.length = 0
      expect(matchesMaterializedManifest(shards, { manifest })).toBe(expected)
      expect(observations).toEqual(order)
    }
  })

  it('rejects incomplete carried manifests with the same code and leaves prior queries usable', async () => {
    const first = transactionFor([fixtureShard(0, ['fixture.semantic']), fixtureShard(1)])
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
    await store.commit(first)
    const pinned = await store.open(first.next.universe)
    try {
      const malformed = [[], first.manifest.slice(1), first.manifest.map((entry) => ({ ...entry, extra: 'unexpected' })),
        first.manifest.map((entry) => ({ ...entry, capabilities: undefined }))]
      for (const manifest of malformed) {
        const transaction = carried(first, manifest)
        await expect(store.commit(transaction)).rejects.toMatchObject({ code: 'MANIFEST_INVALID',
          message: 'The transaction manifest is not the complete materialized next generation.' })
        expect(await store.current(first.next.universe)).toEqual(first.next)
        expect(await pinned.manifest()).toEqual(first.manifest)
      }
      const accepted = carried(first, first.manifest.map((entry) => ({ ...entry, ignored: undefined })))
      await store.commit(accepted)
      const current = await store.open(first.next.universe)
      try {
        expect((await current.facts()).facts.map((fact) => fact.generation)).toEqual([accepted.next.id, accepted.next.id])
        expect((await pinned.facts()).facts.map((fact) => fact.generation)).toEqual([first.next.id, first.next.id])
      } finally { await current.dispose() }
    } finally { await pinned.dispose(); await store.dispose() }
  })

  it('rechecks keys changed by a payload getter after the transaction order check', () => {
    const first = transactionFor([fixtureShard(0), fixtureShard(1)])
    const state = materializeTransaction(undefined, first)
    const actual = first.upserts.find((shard) => shard.facts[0]!.id === id('fact', 0))!
    const other = first.manifest.find((reference) => reference.key !== actual.key)!
    const manifest = [...first.manifest]
    const payload = { index: 0 }
    let armed = false
    const fact: Fact = { ...actual.facts[0]!, get payload() {
      if (armed) manifest.splice(0, manifest.length, other, other)
      return payload
    } }
    const draft = { ...actual, facts: [fact] }
    const updated = { ...draft, digest: factShardDigest(draft) }
    const next = carried(first, [other, other])
    const transaction = { ...next, manifest, upserts: [{ ...updated, facts: [{ ...fact, generation: next.next.id }] }] }
    // Preserve the getter after generation binding so it runs inside validation.
    Object.defineProperty(transaction.upserts[0]!.facts[0], 'payload', Object.getOwnPropertyDescriptor(fact, 'payload')!)
    armed = true
    expect(() => materializeTransaction(state, transaction)).toThrow('The transaction manifest is not the complete materialized next generation.')
    expect(state.generation).toEqual(first.next)
  })
})

function original(shards: ReadonlyMap<string, FactShard>, transaction: Pick<FactTransaction, 'manifest'>): boolean {
  const actual = [...shards.values()].map(shardReference).sort((left, right) => left.key.localeCompare(right.key))
  return stableJson(actual) === stableJson(transaction.manifest)
}
function id<Kind extends string>(kind: Kind, value: unknown) { return deriveAnalysisId(kind, 'memory-manifest-test', { value }) }
function fixtureShard(index: number, capabilities?: readonly string[]): FactShard {
  const fact = Object.freeze({ id: id('fact', index), generation: id('generation', 'pending'), namespace: 'fixture.values', schemaVersion: 1,
    kind: 'value', subject: id('symbol', index), completeness: Object.freeze({ kind: 'complete' as const }),
    provenance: Object.freeze({ pass: id('pass', 'fixture'), passVersion: '1', inputs: Object.freeze([]), evidence: Object.freeze([]) }),
    payload: Object.freeze({ index }) })
  const draft = { key: id('fact-shard-key', index), namespace: fact.namespace, schemaVersion: 1,
    completion: Object.freeze({ kind: 'complete' as const }), facts: Object.freeze([fact]),
    ...(capabilities ? { capabilities: Object.freeze([...capabilities]) } : {}) }
  return Object.freeze({ ...draft, digest: factShardDigest(draft) })
}
function transactionFor(shards: readonly FactShard[]): FactTransaction {
  const manifest = shards.map(shardReference).sort((a, b) => a.key.localeCompare(b.key))
  const identity = { universe: id('project-universe', 'fixture'), sourceManifest: id('source-manifest', 0), capabilities: ['fixture.values'],
    producer: { id: id('producer', 'fixture'), name: 'fixture', version: '1', protocolVersion: 1 } }
  const generation = { ...identity, id: generationIdentity(identity, manifest), sequence: 1 }
  return { protocolVersion: 1, next: generation, manifest, deletes: [], upserts: [...shards].sort((a, b) => a.key.localeCompare(b.key))
    .map((shard) => ({ ...shard, facts: shard.facts.map((fact) => ({ ...fact, generation: generation.id })) })) }
}
function carried(first: FactTransaction, manifest: readonly FactShardReference[]): FactTransaction {
  const identity = { ...first.next, sourceManifest: id('source-manifest', first.next.sequence) }
  return { protocolVersion: 1, base: first.next.id, next: { ...identity, sequence: first.next.sequence + 1,
    id: generationIdentity(identity, manifest) }, manifest, upserts: [], deletes: [] }
}

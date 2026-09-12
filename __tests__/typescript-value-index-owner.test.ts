import { expect, it } from 'vitest'
import { factShardDigest, shardReference, type Fact } from '../analysis/facts/index.ts'
import { generationIdentity, type FactTransaction } from '../analysis/generation/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { ValueIndexOwner } from '../analysis/typescript/value/symbolic/owner.ts'
import { loadValueIndex, type IndexedValues } from '../analysis/typescript/value/symbolic/facts.ts'

it('retires indexed facts when a committed shard changes to an unrelated namespace', async () => {
  const source = deriveAnalysisId('source', 'index-owner-fixture', 'source.ts')
  const universe = deriveAnalysisId('project-universe', 'index-owner-fixture', {})
  const key = deriveAnalysisId('fact-shard-key', 'index-owner-fixture', { slot: 'replaceable' })
  const producer = { id: deriveAnalysisId('producer', 'index-owner-fixture', {}), name: 'fixture', version: '1', protocolVersion: 1 }
  const transaction = (sequence: number, namespace: string, previous?: FactTransaction): FactTransaction => {
    const placeholder = deriveAnalysisId('generation', 'index-owner-fixture', { sequence })
    const fact: Fact = {
      id: deriveAnalysisId('fact', 'index-owner-fixture', { namespace }), generation: placeholder,
      namespace, schemaVersion: 1, kind: namespace === 'typescript.source' ? 'source' : 'value', subject: source,
      completeness: { kind: 'complete' },
      provenance: { pass: deriveAnalysisId('pass', 'index-owner-fixture', {}), passVersion: '1', evidence: [], inputs: [] },
      payload: namespace === 'typescript.source'
        ? { source, revision: deriveAnalysisId('source-revision', 'index-owner-fixture', {}), textDigest: 'fixture', logicalPath: 'source.ts', declaration: false, projectOwned: true }
        : { message: 'This ownership slot now belongs to a different analysis.' },
    }
    const draft = { key, namespace, schemaVersion: 1, completion: { kind: 'complete' as const }, facts: [fact] }
    const shard = { ...draft, digest: factShardDigest(draft) }
    const manifest = [shardReference(shard)]
    const identity = { universe, producer, sourceManifest: deriveAnalysisId('source-manifest', 'index-owner-fixture', { sequence }),
      capabilities: ['fixture.other', 'typescript.source'] }
    const generation = generationIdentity(identity, manifest)
    return { protocolVersion: 1, ...(previous ? { base: previous.next.id } : {}),
      next: { ...identity, id: generation, sequence }, manifest,
      upserts: [{ ...shard, facts: [{ ...fact, generation }] }], deletes: [] }
  }
  const store = createMemoryAnalysisStore()
  const owner = new ValueIndexOwner()
  const queries: Awaited<ReturnType<typeof store.open>>[] = []
  const leases: ReturnType<typeof owner.acquire>[] = []
  const load = async (next: FactTransaction) => {
    await store.commit(next)
    owner.committed(next)
    const query = await store.open(universe)
    queries.push(query)
    const lease = owner.acquire(query)
    leases.push(lease)
    return lease.load()
  }
  try {
    const first = transaction(1, 'typescript.source')
    const before = await load(first)
    expect(before.sources.get(source)?.payload.logicalPath).toBe('source.ts')
    const replacement = transaction(2, 'fixture.other', first)
    const after = await load(replacement)
    expect(after.sources.has(source)).toBe(false)
    expect(before.sources.has(source)).toBe(true)
    const restored = await load(transaction(3, 'typescript.source', replacement))
    expect(restored.sources.get(source)?.payload).toEqual(before.sources.get(source)?.payload)
    expect(after.sources.has(source)).toBe(false)
  } finally {
    for (const lease of leases) lease.release()
    for (const query of queries) await query.dispose()
    owner.close()
    await store.dispose()
  }
})

it.each(['retained universe', 'following generation'] as const)(
  'rebases pending index changes onto a %s while preserving old pins', async (transition) => {
    const namespace = 'typescript.source'
    const universe = deriveAnalysisId('project-universe', 'index-owner-rebase', 'original')
    const otherUniverse = deriveAnalysisId('project-universe', 'index-owner-rebase', 'intermediate')
    const producer = { id: deriveAnalysisId('producer', 'index-owner-rebase', {}), name: 'fixture', version: '1', protocolVersion: 1 }
    const sourceId = (name: string) => deriveAnalysisId('source', 'index-owner-rebase', name)
    const transaction = (
      target: typeof universe, sequence: number, names: readonly string[], changed: readonly string[], previous?: FactTransaction,
    ): FactTransaction => {
      const placeholder = deriveAnalysisId('generation', 'index-owner-rebase', { target, sequence })
      const shards = names.map((name) => {
        const source = sourceId(name)
        const fact: Fact = {
          id: deriveAnalysisId('fact', 'index-owner-rebase', name), generation: placeholder,
          namespace, schemaVersion: 1, kind: 'source', subject: source,
          completeness: { kind: 'complete' },
          provenance: { pass: deriveAnalysisId('pass', 'index-owner-rebase', {}), passVersion: '1', evidence: [], inputs: [] },
          payload: { source, revision: deriveAnalysisId('source-revision', 'index-owner-rebase', name),
            textDigest: name, logicalPath: `${name}.ts`, declaration: false, projectOwned: true },
        }
        const draft = { key: deriveAnalysisId('fact-shard-key', 'index-owner-rebase', name), namespace,
          schemaVersion: 1, completion: { kind: 'complete' as const }, facts: [fact] }
        return { name, shard: { ...draft, digest: factShardDigest(draft) } }
      })
      const manifest = shards.map(({ shard }) => shardReference(shard)).sort((a, b) => a.key.localeCompare(b.key))
      const identity = { universe: target, producer, capabilities: [namespace],
        sourceManifest: deriveAnalysisId('source-manifest', 'index-owner-rebase', { target, sequence, names }) }
      const generation = generationIdentity(identity, manifest)
      return { protocolVersion: 1, ...(previous ? { base: previous.next.id } : {}),
        next: { ...identity, id: generation, sequence }, manifest, deletes: [],
        upserts: shards.filter(({ name }) => changed.includes(name)).map(({ shard }) => ({
          ...shard, facts: shard.facts.map((fact) => ({ ...fact, generation })),
        })).sort((a, b) => a.key.localeCompare(b.key)) }
    }
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
    const owner = new ValueIndexOwner()
    const queries: Awaited<ReturnType<typeof store.open>>[] = []
    const leases: ReturnType<typeof owner.acquire>[] = []
    const commit = async (next: FactTransaction) => {
      await store.commit(next)
      owner.committed(next)
      const query = await store.open(next.next.universe, next.next.id)
      const lease = owner.acquire(query)
      queries.push(query)
      leases.push(lease)
      return { query, load: lease.load }
    }
    const contents = (index: IndexedValues) => [...index.sources]
      .map(([id, fact]) => [id, fact.payload] as const).sort(([a], [b]) => a.localeCompare(b))
    const paths = (index: IndexedValues) => [...index.sources.values()].map((fact) => fact.payload.logicalPath).sort()
    try {
      const first = transaction(universe, 1, ['original'], ['original'])
      const firstPin = await commit(first)
      const initial = await firstPin.load()
      expect(paths(initial)).toEqual(['original.ts'])

      const follows = transition === 'following generation'
      const middle = follows
        ? transaction(universe, 2, ['original', 'intermediate'], ['intermediate'], first)
        : transaction(otherUniverse, 1, ['intermediate'], ['intermediate'])
      const middlePin = await commit(middle)
      // Keep B pinned but never load its value index before C is committed.
      const last = follows
        ? transaction(universe, 3, ['original', 'intermediate', 'latest'], ['latest'], middle)
        : transaction(universe, 2, ['original', 'latest'], ['original', 'latest'], first)
      expect(last.base === middle.next.id).toBe(follows)
      const lastPin = await commit(last)
      const current = await lastPin.load()
      expect(contents(current)).toEqual(contents(await loadValueIndex(lastPin.query)))
      expect(paths(current)).toEqual(follows ? ['intermediate.ts', 'latest.ts', 'original.ts'] : ['latest.ts', 'original.ts'])

      expect(paths(await firstPin.load())).toEqual(['original.ts'])
      expect(contents(initial)).toEqual(contents(await loadValueIndex(firstPin.query)))
      const intermediate = await middlePin.load()
      expect(contents(intermediate)).toEqual(contents(await loadValueIndex(middlePin.query)))
      expect(paths(intermediate)).toEqual(follows ? ['intermediate.ts', 'original.ts'] : ['intermediate.ts'])
      expect(intermediate.sources.has(sourceId('latest'))).toBe(false)
    } finally {
      for (const lease of leases) lease.release()
      for (const query of queries) await query.dispose()
      owner.close()
      await store.dispose()
    }
  },
)

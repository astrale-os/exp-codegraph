import { expect, it } from 'vitest'
import { factShardDigest, shardReference, type Fact } from '../analysis/facts/index.ts'
import { generationIdentity, type FactTransaction } from '../analysis/generation/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { ValueIndexOwner } from '../analysis/typescript/value/symbolic/owner.ts'

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

import { expect, it, vi } from 'vitest'
import { factShardDigest, shardReference, type Completeness, type Fact, type FactShard } from '../analysis/facts/index.ts'
import { generationIdentity, type FactTransaction } from '../analysis/generation/index.ts'
import { deriveAnalysisId, type FactShardKey } from '../analysis/identity/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { createCallProjection } from '../analysis/typescript/value/symbolic/calls.ts'
import { loadValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'
import { ValueIndexOwner } from '../analysis/typescript/value/symbolic/owner.ts'
import { callSelectionKey as key } from '../analysis/typescript/value/symbolic/selection.ts'

const complete: Completeness = { kind: 'complete' }
const unavailable: Completeness = { kind: 'unavailable', reasons: [{ code: 'OTHER_PRODUCER', message: 'Body extraction unavailable.', retryable: true }] }
const limited: Completeness = { kind: 'partial', reasons: [{ code: 'CFG_NESTED_SCOPE_UNSUPPORTED', message: 'Omitted nested scope.', effective: {} }] }
const source = deriveAnalysisId('source', 'selection-owner', 'source')
const ownerId = deriveAnalysisId('symbol', 'selection-owner', 'body')
const occurrence = deriveAnalysisId('occurrence', 'selection-owner', 'call')
const callee = deriveAnalysisId('occurrence', 'selection-owner', 'callee')
const span = { source, revision: deriveAnalysisId('source-revision', 'selection-owner', {}), start: 0, end: 1 }
const placeholder = deriveAnalysisId('generation', 'selection-owner', 'placeholder')
function fact(namespace: string, payload: unknown, completeness = complete): Fact {
  return { id: deriveAnalysisId('fact', 'selection-owner', namespace), generation: placeholder, namespace, schemaVersion: 1,
    kind: namespace.split('.').at(-1)!, subject: namespace === 'typescript.body' ? ownerId : source, payload, completeness,
    provenance: { pass: deriveAnalysisId('pass', 'selection-owner', {}), passVersion: '1', evidence: [span], inputs: [] },
  }
}
function sourceFact(path: string) { return fact('typescript.source', { source, revision: span.revision, textDigest: path, logicalPath: path, declaration: false, projectOwned: true }) }
function bodyFact(calls = true, completeness = complete) {
  return fact('typescript.body', { body: { function: ownerId, execution: 'sync', parameters: [],
    occurrences: [{ id: occurrence, owner: ownerId, syntax: 'CallExpression', kind: 'call', span },
      { id: callee, owner: ownerId, syntax: 'Identifier', kind: 'expression', span }],
    relations: [{ parent: occurrence, child: callee, role: 'callee' }], blocks: [{ id: 'entry', occurrences: [occurrence, callee] }], edges: [], definitions: [],
    calls: calls ? [{ occurrence, typeArguments: [], arguments: [], bindings: [], callbacks: [], dynamic: true }] : [],
    summary: { function: ownerId, returns: [], throws: [], captures: [], calls: calls ? [occurrence] : [], escapes: [], recursion: false },
  }, values: {}, completeness }, completeness)
}

async function fixture() {
  const universe = deriveAnalysisId('project-universe', 'selection-owner', {})
  const producer = { id: deriveAnalysisId('producer', 'selection-owner', {}), name: 'fixture', version: '1', protocolVersion: 1 }
  const store = createMemoryAnalysisStore(), owner = new ValueIndexOwner()
  const shards = new Map<FactShardKey, FactShard>()
  const queries: Awaited<ReturnType<typeof store.open>>[] = []
  const leases: ReturnType<typeof owner.acquire>[] = []
  let previous: FactTransaction | undefined, sequence = 0
  const shardKey = (namespace: string) => deriveAnalysisId('fact-shard-key', 'selection-owner', namespace)
  return {
    async commit(inputs: readonly { fact: Fact; capabilities?: readonly string[]; completion?: Completeness }[], removed: readonly string[] = [],
      capabilities: readonly string[] = ['typescript.body', 'typescript.source']) {
      const updates = inputs.map(({ fact, capabilities, completion }) => {
        const draft = { key: shardKey(fact.namespace), namespace: fact.namespace, schemaVersion: 1,
          completion: completion ?? complete, facts: [fact], ...(capabilities ? { capabilities } : {}),
        }
        return { ...draft, digest: factShardDigest(draft) }
      }).sort((left, right) => left.key.localeCompare(right.key))
      const deletes = removed.map(shardKey).sort()
      for (const key of deletes) shards.delete(key)
      for (const shard of updates) shards.set(shard.key, shard)
      const manifest = [...shards.values()].map(shardReference).sort((left, right) => left.key.localeCompare(right.key))
      const identity = { universe, producer, sourceManifest: deriveAnalysisId('source-manifest', 'selection-owner', ++sequence), capabilities }
      const generation = generationIdentity(identity, manifest)
      const transaction: FactTransaction = { protocolVersion: 1, ...(previous ? { base: previous.next.id } : {}),
        next: { ...identity, id: generation, sequence }, manifest, deletes,
        upserts: updates.map((shard) => ({ ...shard, facts: shard.facts.map((fact) => ({ ...fact, generation })) })),
      }
      await store.commit(transaction); owner.committed(transaction); previous = transaction
      const query = await store.open(universe)
      const lease = owner.acquire(query)
      queries.push(query); leases.push(lease)
      return { query, load: lease.load }
    },
    async dispose() { for (const lease of leases) lease.release(); for (const query of queries) await query.dispose(); owner.close(); await store.dispose() },
  }
}

it('journals capability-only commits from other namespaces and global declarations atomically', async () => {
  const f = await fixture()
  try {
    const first = await f.commit([])
    const before = await first.load()
    const other = await f.commit([{ fact: fact('fixture.other', {}), capabilities: ['typescript.body'], completion: unavailable }])
    const index = await other.load()
    expect(index.work.facts).toBe(0)
    expect(index.revision.parent).toBe(before.revision.token)
    expect([...index.revision.changed]).toEqual([key.global])
    expect((await createCallProjection(other.query, async () => index)({ paths: [] })).completeness).toEqual(unavailable)
    expect((await createCallProjection(first.query, async () => before)()).completeness).toEqual(complete)
    const removed = await f.commit([], ['fixture.other'])
    const restored = await removed.load()
    expect([...restored.revision.changed]).toEqual([key.global])
    expect(restored.callsSelection?.completion).toEqual(complete)
    const withdrawn = await f.commit([], [], ['typescript.source'])
    const missing = await withdrawn.load()
    expect(missing.work.facts).toBe(0)
    expect([...missing.revision.changed]).toEqual([key.global])
    expect(missing.callsSelection?.completion.kind).toBe('unavailable')
  } finally { await f.dispose() }
})

it('compacts unread source/body/capability edits and lets an old pin load after the destination', async () => {
  const f = await fixture()
  try {
    const first = await f.commit([{ fact: sourceFact('before.ts') }, { fact: bodyFact() }])
    const before = await first.load()
    const pending = await f.commit([{ fact: sourceFact('middle.ts') }, { fact: bodyFact(false, limited) }])
    const final = await f.commit([{ fact: sourceFact('after.ts') }, { fact: bodyFact() },
      { fact: fact('fixture.other', {}), capabilities: ['typescript.body'], completion: unavailable }])
    const manifest = vi.spyOn(final.query, 'manifest')
    const index = await final.load()
    expect(manifest).not.toHaveBeenCalled()
    manifest.mockRestore()
    expect(index.revision.parent).toBe(before.revision.token)
    expect(index.revision.changed.has(key.path('before.ts'))).toBe(true)
    expect(index.revision.changed.has(key.path('after.ts'))).toBe(true)
    expect(index.revision.changed.has(key.path('middle.ts'))).toBe(false)
    const fresh = await loadValueIndex(final.query)
    const calls = createCallProjection(final.query, async () => index)
    const oracle = createCallProjection(final.query, async () => fresh)
    for (const options of [{}, { paths: ['after.ts'] }, { paths: ['before.ts'] }, { sources: [source] }, { paths: [] }]) {
      expect(await calls(options)).toEqual(await oracle(options))
    }
    const previous = await pending.load()
    expect(previous.revision.parent).toBe(before.revision.token)
    expect(previous.revision.token).not.toBe(index.revision.token)
    expect((await createCallProjection(pending.query, async () => previous)({ paths: ['middle.ts'] }))).toEqual({ sites: [], completeness: limited })
    expect((await calls({ paths: ['after.ts'] })).sites).toHaveLength(1)
    expect((await createCallProjection(first.query, async () => before)({ paths: ['before.ts'] })).sites).toHaveLength(1)
  } finally { await f.dispose() }
})

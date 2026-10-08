import { describe, expect, it } from 'vitest'
import { factShardDigest, shardReference, type Completeness, type Fact, type FactShard } from '../analysis/facts/index.ts'
import { generationIdentity, type FactTransaction } from '../analysis/generation/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import type { AnalysisQuery } from '../analysis/query/index.ts'
import { createTypeScriptFactReader, TypeScriptFactContractError, type TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { createTypeScriptStructuralReader } from '../analysis/typescript/structure/reader.ts'
import { StructuralIndex, StructuralIndexOwner, structuralKey } from '../analysis/typescript/structure/owner.ts'
import type { TypeScriptStructureFact } from '../analysis/typescript/structure/model.ts'

const namespace = 'typescript.structure', complete: Completeness = { kind: 'complete' }
const universe = deriveAnalysisId('project-universe', 'structural-storage', 'main')
const producer = { id: deriveAnalysisId('producer', 'structural-storage', {}), name: 'fixture', version: '1', protocolVersion: 1 }
const symbol = deriveAnalysisId('symbol', 'structural-storage', 'api')
const slotKey = (slot: string) => deriveAnalysisId('fact-shard-key', 'structural-storage', slot)
const placeholder = deriveAnalysisId('generation', 'structural-storage', 'placeholder')
const failure = (code: string): Completeness => ({ kind: 'partial', reasons: [{ code, message: code, effective: {} }] })

function source(path: string, version = '1', overrides: Partial<TypeScriptStructureFact> = {}, completeness = complete): TypeScriptFact<'structure'> {
  const source = deriveAnalysisId('source', 'structural-storage', path)
  const payload: TypeScriptStructureFact = {
    source, revision: deriveAnalysisId('source-revision', 'structural-storage', { path, version }), logicalPath: path, textDigest: version,
    symbols: [{ symbol, name: 'api', declarations: [], origin: { package: 'fixture', file: 'api.ts', path: ['api'] }, generationScoped: false }],
    exports: path === 'api.ts' ? [{ name: 'api', symbol, typeOnly: false }] : [], references: [], dependencies: [],
    completeness: { exports: complete, references: complete, dependencies: complete }, ...overrides,
  }
  return { id: deriveAnalysisId('fact', namespace, { payload, completeness }), generation: placeholder, namespace, schemaVersion: 1,
    kind: 'structure', subject: source, payload, completeness,
    provenance: { pass: deriveAnalysisId('pass', 'structural-storage', {}), passVersion: '1', evidence: [], inputs: [] } }
}
function consumer(path: string, version = '1', targetPath = 'api.ts') {
  return source(path, version, { references: [{ symbol, kind: 'value', start: 5, end: 8 }],
    dependencies: [{ kind: 'import', start: 0, end: 4, typeOnly: false, specifier: `./${targetPath}`, targetPath }] })
}
function foreign(): Fact {
  return { ...source('foreign.ts'), id: deriveAnalysisId('fact', 'fixture.other', {}), namespace: 'fixture.other', kind: 'message',
    payload: { message: 'This replaceable ownership slot now belongs to another analysis.' } }
}
function transaction(sequence: number, slots: Readonly<Record<string, Fact>>, previous?: FactTransaction, target = universe): FactTransaction {
  const shards: FactShard[] = Object.entries(slots).map(([slot, fact]) => {
    const draft = { key: slotKey(slot), namespace: fact.namespace, schemaVersion: 1, completion: fact.completeness, facts: [fact] }
    return { ...draft, digest: factShardDigest(draft) }
  }).sort((a, b) => a.key.localeCompare(b.key))
  const manifest = shards.map(shardReference)
  const identity = { universe: target, producer, capabilities: [...new Set(shards.map(shard => shard.namespace))].sort(),
    sourceManifest: deriveAnalysisId('source-manifest', 'structural-storage', { target, sequence, manifest }) }
  const generation = generationIdentity(identity, manifest), before = new Map(previous?.manifest.map(entry => [entry.key, entry]) ?? [])
  return { protocolVersion: 1, ...(previous ? { base: previous.next.id } : {}), next: { ...identity, id: generation, sequence }, manifest,
    upserts: shards.filter(shard => before.get(shard.key)?.digest !== shard.digest).map(shard => ({ ...shard, facts: shard.facts.map(fact => ({ ...fact, generation })) })),
    deletes: [...before.keys()].filter(key => !shards.some(shard => shard.key === key)).sort() }
}

function harness() {
  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 }), owner = new StructuralIndexOwner()
  const queries: AnalysisQuery[] = [], leases: ReturnType<StructuralIndexOwner['acquire']>[] = []
  const acquire = (query: AnalysisQuery) => { const lease = owner.acquire(query); leases.push(lease); return lease }
  return { store, owner, acquire,
    async commit(next: FactTransaction, notify = true) {
      await store.commit(next)
      if (notify) owner.committed(next)
      const query = await store.open(next.next.universe, next.next.id); queries.push(query)
      return { query, ...acquire(query) }
    },
    async close() { for (const lease of leases) lease.release(); owner.close(); for (const query of queries) await query.dispose(); await store.dispose() },
  }
}
async function cold(query: AnalysisQuery) {
  const owner = new StructuralIndexOwner(), lease = owner.acquire(query)
  try { return await lease.load() } finally { lease.release(); owner.close() }
}
function contents(index: StructuralIndex) {
  return { files: [...index.files].map(([path, fact]) => [path, fact.id, fact.payload]).sort(),
    references: [...index.references].flatMap(([symbol, posting]) => [...posting].map(([path, entries]) =>
      [symbol, path, entries.map(entry => entry.reference)])).sort(),
    incoming: [...index.incoming].flatMap(([target, posting]) => [...posting].map(([path, entries]) =>
      [target, path, entries.map(entry => entry.dependency)])).sort(), capability: index.capability }
}
function queryWith(query: AnalysisQuery, overrides: Partial<AnalysisQuery>): AnalysisQuery {
  return { generation: query.generation, dispose: query.dispose.bind(query), manifest: query.manifest.bind(query),
    capabilities: query.capabilities.bind(query), headers: query.headers.bind(query), headersById: query.headersById.bind(query),
    exportHeaders: query.exportHeaders.bind(query), facts: query.facts.bind(query), factsById: query.factsById.bind(query),
    export: query.export.bind(query), ...overrides }
}

describe('structural fact admission', () => {
  it.each([
    ['source identity', (payload: TypeScriptStructureFact) => ({ ...payload, source: '' }), 'source:not-string'],
    ['reference range', (payload: TypeScriptStructureFact) => ({ ...payload, references: [{ symbol, kind: 'value', start: 8, end: 5 }] }), 'references:invalid-array'],
    ['reference taxonomy', (payload: TypeScriptStructureFact) => ({ ...payload, references: [{ symbol, kind: 'runtime', start: 1, end: 2 }] }), 'references:invalid-array'],
    ['dependency range', (payload: TypeScriptStructureFact) => ({ ...payload, dependencies: [{ kind: 'import', start: -1, end: 5, typeOnly: false }] }), 'dependencies:invalid-array'],
    ['canonical export', (payload: TypeScriptStructureFact) => ({ ...payload, exports: [{ name: 'api', symbol: 'unknown', typeOnly: false }] }), 'symbol:missing'],
    ['canonical reference', (payload: TypeScriptStructureFact) => ({ ...payload, references: [{ symbol: 'unknown', kind: 'value', start: 1, end: 2 }] }), 'symbol:missing'],
    ['complete unresolved reference', (payload: TypeScriptStructureFact) => ({ ...payload, references: [{ kind: 'value', start: 1, end: 2 }] }), 'references:complete-unresolved'],
    ['complete unresolved dependency', (payload: TypeScriptStructureFact) => ({ ...payload, dependencies: [{ kind: 'import', start: 1, end: 2, typeOnly: false, specifier: './missing' }] }), 'dependencies:complete-unresolved'],
    ['duplicate symbols', (payload: TypeScriptStructureFact) => ({ ...payload, symbols: [...payload.symbols, ...payload.symbols] }), 'symbols:duplicate'],
    ['coverage', (payload: TypeScriptStructureFact) => ({ ...payload, completeness: {} }), 'completeness:invalid'],
  ] as const)('rejects a malformed %s after portable store admission', async (_name, mutate, diagnostic) => {
    const h = harness(), valid = source('api.ts')
    const bad = { ...valid, id: deriveAnalysisId('fact', 'structural-malformed', diagnostic), payload: mutate(valid.payload) }
    try {
      const pinned = await h.commit(transaction(1, { bad }))
      const read = createTypeScriptFactReader(pinned.query)
      await expect(read.factsById('structure', [bad.id])).rejects.toMatchObject({ code: 'TYPESCRIPT_FACT_CONTRACT_INVALID', kind: 'structure', diagnostics: expect.arrayContaining([diagnostic]) })
      await expect(pinned.load()).rejects.toBeInstanceOf(TypeScriptFactContractError)
    } finally { await h.close() }
  })

  it('admits empty coverage, nonliteral dynamic edges and unresolved empty literals without inventing targets', async () => {
    const h = harness(), dynamic = failure('DYNAMIC_UNRESOLVED')
    const file = source('dynamic.ts', '1', { dependencies: [{ kind: 'dynamic', start: 2, end: 15, typeOnly: false }],
      completeness: { exports: complete, references: complete, dependencies: dynamic } }, dynamic)
    try {
      const literal = source('empty-literal.ts', '1', { dependencies: [{ kind: 'import', start: 0, end: 9, typeOnly: false, specifier: '' }],
        completeness: { exports: complete, references: complete, dependencies: dynamic } }, dynamic)
      const pinned = await h.commit(transaction(1, { dynamic: file, literal, empty: source('empty.ts') }))
      const structure = createTypeScriptStructuralReader(pinned.load)
      expect(await structure.dependencies({ paths: ['dynamic.ts'] })).toMatchObject({ completeness: dynamic,
        dependencies: [{ path: 'dynamic.ts', kind: 'dynamic', typeOnly: false }] })
      const [edge] = (await structure.dependencies({ paths: ['dynamic.ts'] })).dependencies
      expect(edge).not.toHaveProperty('specifier'); expect(edge).not.toHaveProperty('targetPath')
      const unresolved = await structure.dependencies({ paths: ['empty-literal.ts'] })
      expect(unresolved).toMatchObject({ completeness: dynamic, dependencies: [{ specifier: '', kind: 'import' }] })
      expect(unresolved.dependencies[0]).not.toHaveProperty('targetPath')
      expect(await structure.dependencies({ paths: ['empty.ts'] })).toMatchObject({ dependencies: [], completeness: complete })
      expect(await structure.references({ target: { path: 'empty.ts', name: 'missing' } })).toMatchObject({ target: { kind: 'missing' }, references: [], completeness: complete })
    } finally { await h.close() }
  })

  it('distinguishes a known empty source from an explicit path outside the loaded inventory', async () => {
    const h = harness()
    try {
      const pinned = await h.commit(transaction(1, { api: source('api.ts'), empty: source('empty.ts') }))
      const reader = createTypeScriptStructuralReader(pinned.load)
      const unavailable = { kind: 'unavailable', reasons: expect.arrayContaining([expect.objectContaining({ code: 'STRUCTURAL_SOURCE_UNAVAILABLE' })]) }
      expect(await reader.dependencies({ paths: ['not-loaded.ts'] })).toMatchObject({ dependencies: [], completeness: unavailable })
      expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['not-loaded.ts'] })).toMatchObject({ references: [], completeness: unavailable })
      expect(await reader.dependencies({ paths: ['empty.ts', 'not-loaded.ts'] })).toMatchObject({ dependencies: [], completeness: unavailable })
      expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['empty.ts'] })).toMatchObject({ references: [], completeness: complete })
      expect(await reader.dependencies({ paths: ['empty.ts'] })).toMatchObject({ dependencies: [], completeness: complete })
    } finally { await h.close() }
  })
})

describe('structural index ownership', () => {
  it('shares loads between leases, releases idempotently and retries a failed lazy admission', async () => {
    const h = harness()
    try {
      const pinned = await h.commit(transaction(1, { api: source('api.ts'), consumer: consumer('consumer.ts') }))
      let fails = true
      const unreliable = queryWith(pinned.query, { export: async function* (filter) {
        if (fails) { fails = false; throw Error('Transient backing store failure.') }
        yield* pinned.query.export(filter)
      } })
      const first = h.acquire(unreliable), second = h.acquire(pinned.query)
      const a = first.load(), b = second.load()
      expect(a).toBe(b)
      await expect(a).rejects.toThrow('Transient backing store failure.')
      await expect(b).rejects.toThrow('Transient backing store failure.')
      const current = await second.load()
      expect(contents(current)).toEqual(contents(await cold(pinned.query)))
      first.release(); first.release()
      await expect(first.load()).rejects.toThrow('lease is released')
      expect(await second.load()).toBe(current)
      second.release(); await expect(second.load()).rejects.toThrow('lease is released')
    } finally { await h.close() }
  })

  it('rebases several unloaded deltas, retires namespace replacements and preserves old pins', async () => {
    const h = harness(), api = source('api.ts'), oldConsumer = consumer('old.ts'), keep = consumer('keep.ts')
    try {
      const a = transaction(1, { api, old: oldConsumer, keep }), first = await h.commit(a), original = await first.load()
      const b = transaction(2, { api, keep, late: consumer('late.ts') }, a), middle = await h.commit(b)
      // Neither B nor its postings are materialized before C is committed.
      const c = transaction(3, { api, keep: foreign(), late: consumer('late.ts', '2') }, b), latest = await h.commit(c)
      const current = await latest.load()
      expect(contents(current)).toEqual(contents(await cold(latest.query)))
      expect([...current.files.keys()].sort()).toEqual(['api.ts', 'late.ts'])
      expect(current.revision.parent).toBe(original.revision.token)
      expect(current.revision.changed).toContain(structuralKey.path('old.ts'))
      expect(current.revision.changed).toContain(structuralKey.references(symbol, 'keep.ts'))
      const intermediate = await middle.load()
      expect(contents(intermediate)).toEqual(contents(await cold(middle.query)))
      expect([...intermediate.files.keys()].sort()).toEqual(['api.ts', 'keep.ts', 'late.ts'])
      expect(await first.load()).toBe(original)
      expect([...original.files.keys()].sort()).toEqual(['api.ts', 'keep.ts', 'old.ts'])
    } finally { await h.close() }
  })

  it('recovers the latest reader from its own pinned query when an awaited lazy base fails', async () => {
    const h = harness()
    let reject!: (error: Error) => void, entered!: () => void
    const gate = new Promise<never>((_resolve, fail) => { reject = fail })
    const started = new Promise<void>(resolve => { entered = resolve })
    try {
      const a = transaction(1, { api: source('api.ts') }), first = await h.commit(a)
      const broken = h.acquire(queryWith(first.query, { export: async function* () { entered(); await gate } }))
      const oldLoad = broken.load()
      await started
      const b = transaction(2, { api: source('api.ts', '2'), consumer: consumer('consumer.ts') }, a), latest = await h.commit(b)
      const currentLoad = latest.load()
      reject(Error('Base reader was disposed during its pending load.'))
      await expect(oldLoad).rejects.toThrow('Base reader was disposed')
      expect(contents(await currentLoad)).toEqual(contents(await cold(latest.query)))
      expect([...((await first.load()).files.keys())]).toEqual(['api.ts'])
      expect((await first.load()).files.get('api.ts')?.payload.textDigest).toBe('1')
    } finally { await h.close() }
  })

  it('rejects a missing committed source rather than publishing an incomplete incremental index', async () => {
    const h = harness()
    try {
      const a = transaction(1, { api: source('api.ts') }), first = await h.commit(a), original = await first.load()
      const b = transaction(2, { api: source('api.ts', '2'), consumer: consumer('consumer.ts') }, a), latest = await h.commit(b)
      const missing = h.acquire(queryWith(latest.query, { factsById: async () => [] }))
      await expect(missing.load()).rejects.toThrow('A committed structural source is missing in its pinned query.')
      expect(await first.load()).toBe(original)
      const recovered = await latest.load()
      expect(contents(recovered)).toEqual(contents(await cold(latest.query)))
      expect([...recovered.files.keys()].sort()).toEqual(['api.ts', 'consumer.ts'])
    } finally { await h.close() }
  })

  it('uses the complete pinned query after an external writer breaks its observed lineage', async () => {
    const h = harness(), api = source('api.ts')
    try {
      const a = transaction(1, { api }), first = await h.commit(a), original = await first.load()
      const b = transaction(2, { api, unseen: consumer('unseen.ts') }, a)
      await h.commit(b, false)
      const c = transaction(3, { api, unseen: consumer('unseen.ts'), latest: consumer('latest.ts') }, b), last = await h.commit(c)
      const current = await last.load()
      expect(contents(current)).toEqual(contents(await cold(last.query)))
      expect([...current.files.keys()].sort()).toEqual(['api.ts', 'latest.ts', 'unseen.ts'])
      expect(current.revision.parent).not.toBe(original.revision.token)
      expect(await first.load()).toBe(original)
      expect(original.files.has('unseen.ts')).toBe(false)
    } finally { await h.close() }
  })

  it('rebases a retained universe through an unloaded intermediate without mixing memberships', async () => {
    const h = harness(), otherUniverse = deriveAnalysisId('project-universe', 'structural-storage', 'other')
    try {
      const a = transaction(1, { original: source('original.ts') }), first = await h.commit(a)
      const original = await first.load()
      const b = transaction(1, { intermediate: source('intermediate.ts') }, undefined, otherUniverse), middle = await h.commit(b)
      const c = transaction(2, { original: source('original.ts'), latest: source('latest.ts') }, a), last = await h.commit(c)
      const current = await last.load()
      expect(contents(current)).toEqual(contents(await cold(last.query)))
      expect([...current.files.keys()].sort()).toEqual(['latest.ts', 'original.ts'])
      expect([...((await middle.load()).files.keys())]).toEqual(['intermediate.ts'])
      expect(await first.load()).toBe(original)
      expect(current.files.has('intermediate.ts')).toBe(false)
    } finally { await h.close() }
  })

  it('rejects duplicate source ownership atomically and recovers after a later valid generation', async () => {
    const h = harness(), api = source('api.ts')
    try {
      const a = transaction(1, { api }), first = await h.commit(a), original = await first.load()
      const b = transaction(2, { api, duplicate: source('api.ts', 'duplicate') }, a), invalid = await h.commit(b)
      await expect(invalid.load()).rejects.toThrow('Duplicate structural source ownership: api.ts')
      expect(await first.load()).toBe(original)
      expect(original.files.get('api.ts')?.id).toBe(api.id)
      const c = transaction(3, { api: source('api.ts', 'fixed'), consumer: consumer('consumer.ts') }, b), current = await h.commit(c)
      const recovered = await current.load()
      expect(contents(recovered)).toEqual(contents(await cold(current.query)))
      expect([...recovered.files.keys()].sort()).toEqual(['api.ts', 'consumer.ts'])
    } finally { await h.close() }
  })

  it('replaces changed payloads and postings when a producer reuses a fact ID in a new generation', async () => {
    const h = harness(), api = source('api.ts'), other = source('other.ts'), before = consumer('consumer.ts')
    const nextSymbol = deriveAnalysisId('symbol', 'structural-storage', 'replacement')
    const updated = source('consumer.ts', '2', {
      symbols: [{ symbol: nextSymbol, name: 'replacement', declarations: [], generationScoped: false }],
      references: [{ symbol: nextSymbol, kind: 'value', start: 12, end: 15 }],
      dependencies: [{ kind: 'import', start: 0, end: 10, typeOnly: false, specifier: './other.ts', targetPath: 'other.ts' }],
    })
    const replacement = { ...updated, id: before.id }
    try {
      const a = transaction(1, { api, other, consumer: before }), first = await h.commit(a), original = await first.load()
      const b = transaction(2, { api, other, consumer: replacement }, a), latest = await h.commit(b), current = await latest.load()
      expect(contents(current)).toEqual(contents(await cold(latest.query)))
      expect(current.files.get('consumer.ts')?.id).toBe(before.id)
      expect(current.files.get('consumer.ts')?.payload.revision).toBe(updated.payload.revision)
      expect(current.references.get(symbol)).toBeUndefined()
      expect(current.incoming.get('api.ts')).toBeUndefined()
      expect(current.revision.changed).toContain(structuralKey.references(symbol, 'consumer.ts'))
      expect(current.revision.changed).toContain(structuralKey.references(nextSymbol, 'consumer.ts'))
      const reader = createTypeScriptStructuralReader(latest.load)
      expect((await reader.references({ target: { symbol: nextSymbol } })).references).toEqual([
        { symbol: nextSymbol, kind: 'value', path: 'consumer.ts', span: {
          source: updated.payload.source, revision: updated.payload.revision, start: 12, end: 15,
        } },
      ])
      expect((await reader.dependencies({ paths: ['consumer.ts'] })).dependencies[0]?.targetPath).toBe('other.ts')
      expect(await first.load()).toBe(original)
      expect(original.references.get(symbol)?.get('consumer.ts')?.[0]?.reference.start).toBe(5)
      expect(original.files.get('consumer.ts')?.payload.revision).toBe(before.payload.revision)
    } finally { await h.close() }
  })

  it.each([false, true])('preserves provider/envelope uncertainty when payload dimensions are scoped (attributed=%s)', async attributed => {
    const h = harness(), provider = failure('PROVIDER_UNCERTAIN'), dimension = failure('FILE_REFERENCES_UNCERTAIN')
    const envelope = attributed ? { kind: 'partial' as const, reasons: [
      ...(provider.kind === 'partial' ? provider.reasons : []), ...(dimension.kind === 'partial' ? dimension.reasons : []),
    ] } : provider
    const api = source('api.ts', '1', { completeness: {
      exports: complete, references: attributed ? dimension : complete, dependencies: complete,
    } }, envelope)
    try {
      const pinned = await h.commit(transaction(1, { api, empty: source('empty.ts') })), index = await pinned.load()
      expect(contents(index)).toEqual(contents(await cold(pinned.query)))
      expect(index.capability).toEqual(provider)
      const reader = createTypeScriptStructuralReader(pinned.load)
      expect(await reader.references({ target: { path: 'api.ts', name: 'missing' }, paths: [] })).toMatchObject({ references: [], completeness: provider })
      expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['empty.ts'] })).toMatchObject({ references: [], completeness: provider })
      expect(await reader.dependencies({ paths: ['empty.ts'] })).toMatchObject({ dependencies: [], completeness: provider })
      expect(await reader.dependencies({ paths: [] })).toMatchObject({ dependencies: [], completeness: provider })
      if (attributed) expect((await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['api.ts'] })).completeness)
        .toMatchObject({ kind: 'partial', reasons: expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_UNCERTAIN' }), expect.objectContaining({ code: 'FILE_REFERENCES_UNCERTAIN' })]) })
    } finally { await h.close() }
  })

  it('keeps attributable partial coverage scoped and restores it when the partial source disappears', async () => {
    const h = harness(), partial = failure('FILE_REFERENCES_PARTIAL'), api = source('api.ts'), good = consumer('good.ts')
    const bad = source('bad.ts', '1', { completeness: { exports: complete, references: partial, dependencies: complete } }, partial)
    const other = source('other.ts', '1', { completeness: { exports: complete, references: partial, dependencies: complete } }, partial)
    try {
      const a = transaction(1, { api, good, bad, other }), first = await h.commit(a)
      const initial = await first.load(), reader = createTypeScriptStructuralReader(first.load)
      expect(initial.capability).toEqual(complete)
      expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['good.ts'] })).toMatchObject({ completeness: complete })
      expect(await reader.references({ target: { path: 'api.ts', name: 'api' } })).toMatchObject({ completeness: partial })
      expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['bad.ts'] })).toMatchObject({ completeness: partial })
      // Reference coverage must not poison a different query product in that source.
      expect(await reader.dependencies({ paths: ['bad.ts'] })).toMatchObject({ completeness: complete })
      const b = transaction(2, { api, good, other }, a), middle = await h.commit(b)
      // The shared reason still belongs to other.ts after bad.ts is removed.
      const middleReader = createTypeScriptStructuralReader(middle.load)
      expect(await middleReader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['good.ts'] })).toMatchObject({ completeness: complete })
      expect(await middleReader.references({ target: { path: 'api.ts', name: 'api' } })).toMatchObject({ completeness: partial })
      const c = transaction(3, { api, good }, b), latest = await h.commit(c), current = await latest.load()
      expect(contents(current)).toEqual(contents(await cold(latest.query)))
      expect(current.revision.changed).toContain(structuralKey.coverage('references', 'other.ts'))
      expect(await createTypeScriptStructuralReader(latest.load).references({ target: { path: 'api.ts', name: 'api' } })).toMatchObject({ completeness: complete })
      expect(initial.files.has('bad.ts')).toBe(true)
    } finally { await h.close() }
  })

  it('propagates unattributed provider failure into every scope instead of certifying local absence', async () => {
    const file = source('api.ts'), problem = failure('PROVIDER_LOST_SOURCE')
    const index = new StructuralIndex().update([file], [], [{ capability: namespace, completeness: problem }])
    const reader = createTypeScriptStructuralReader(async () => index)
    expect(await reader.references({ target: { path: 'api.ts', name: 'missing' }, paths: [] })).toMatchObject({ completeness: problem })
    expect(await reader.dependencies({ paths: [] })).toMatchObject({ dependencies: [], completeness: problem })
  })

  it('matches attributable reasons canonically across payload/envelope property order and subsequent revisions', async () => {
    const envelope: Completeness = { kind: 'partial', reasons: [{ code: 'FILE_PARTIAL', message: 'File incomplete.', effective: { b: 2, a: 1 } }] }
    const payload: Completeness = { kind: 'partial', reasons: [{ effective: { a: 1, b: 2 }, message: 'File incomplete.', code: 'FILE_PARTIAL' }] }
    const api = source('api.ts'), empty = source('empty.ts')
    const bad = source('bad.ts', '1', { completeness: { exports: complete, references: payload, dependencies: complete } }, envelope)
    const capabilities = [{ capability: namespace, completeness: envelope }]
    const before = new StructuralIndex().update([api, empty, bad], [], capabilities)
    const reader = createTypeScriptStructuralReader(async () => before)
    expect(before.capability).toEqual(complete)
    expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['empty.ts'] })).toMatchObject({ references: [], completeness: complete })
    expect(await reader.references({ target: { path: 'api.ts', name: 'api' }, paths: ['bad.ts'] })).toMatchObject({ references: [], completeness: payload })
    const reordered = source('bad.ts', '2', { completeness: { exports: complete, references: envelope, dependencies: complete } }, payload)
    const after = before.update([reordered], [bad.id], [{ capability: namespace, completeness: payload }])
    expect(after.capability).toEqual(complete)
    expect(contents(after)).toEqual(contents(new StructuralIndex().update([api, empty, reordered], [], [{ capability: namespace, completeness: payload }])))
    expect(after.revision.changed).not.toContain(structuralKey.coverage('references', 'bad.ts'))
    expect(after.revision.changed).not.toContain(structuralKey.capability)
  })
})

describe('standalone structural reader ownership', () => {
  it.each([false, true])('disposes idempotently and rejects every query without reacquiring its loader (materialized=%s)', async materialized => {
    const index = new StructuralIndex().update([source('api.ts'), consumer('consumer.ts')], [], [{ capability: namespace, completeness: complete }])
    let loads = 0, checks = 0
    const reader = createTypeScriptStructuralReader(async () => { loads++; return index }, {
      check: () => { checks++ }, selection: () => {},
    })
    if (materialized) expect((await reader.references({ target: { path: 'api.ts', name: 'api' } })).references).toHaveLength(1)
    const before = checks
    reader.dispose(); reader.dispose()
    await expect(reader.exports({ path: 'api.ts' })).rejects.toThrow('disposed')
    await expect(reader.references({ target: { path: 'api.ts', name: 'api' } })).rejects.toThrow('disposed')
    await expect(reader.dependencies()).rejects.toThrow('disposed')
    await expect(reader.dependents({ path: 'api.ts', transitive: true })).rejects.toThrow('disposed')
    expect(loads).toBe(materialized ? 1 : 0)
    expect(checks).toBe(before)
  })

  it('rejects an in-flight query disposed before its loader completes', async () => {
    let finish!: (index: StructuralIndex) => void, entered!: () => void, selections = 0
    const pending = new Promise<StructuralIndex>(resolve => { finish = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const reader = createTypeScriptStructuralReader(() => { entered(); return pending }, {
      check: () => {}, selection: () => { selections++ },
    })
    const result = reader.references({ target: { path: 'api.ts', name: 'api' } })
    await started
    reader.dispose()
    finish(new StructuralIndex().update([source('api.ts')], [], [{ capability: namespace, completeness: complete }]))
    await expect(result).rejects.toThrow('disposed')
    await expect(reader.dependencies()).rejects.toThrow('disposed')
    expect(selections).toBe(0)
  })
})

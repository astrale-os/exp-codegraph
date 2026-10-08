import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import type { AnalysisQuery, CapabilityStatus } from '../analysis/query/index.ts'
import { SemanticComputationCache } from '../analysis/typescript/project/compute.ts'
import type { TypeScriptSemanticReader } from '../analysis/typescript/project/model.ts'
import type { StructuralIndex } from '../analysis/typescript/structure/owner.ts'
import type { TypeScriptReferenceQuery } from '../analysis/typescript/structure/model.ts'
import { ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import { IndexedValues, type ValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'

interface Selection {
  readonly keys: readonly string[]
  readonly rows: readonly string[]
  readonly completeness?: 'complete' | 'partial'
}
interface FixtureIndex {
  readonly revision: StructuralIndex['revision']
  readonly selections: Readonly<Record<string, Selection>>
  readonly certificate?: StructuralIndex['revision']
}
interface FixtureScope {
  readonly signal?: AbortSignal
  check(): void
  selection(revision: StructuralIndex['revision'], keys: readonly string[]): void
}

// The structural query implementation has its own independent compiler oracle.
// Here the factory emits deterministic read certificates, isolating the shared
// computation cache's invalidation, ownership and memory contracts.
vi.mock('../analysis/typescript/structure/reader.ts', () => ({
  createTypeScriptStructuralReader: (load: () => Promise<FixtureIndex>, scope?: FixtureScope) => {
    let activeLoad: (() => Promise<FixtureIndex>) | undefined = load
    const check = () => {
      if (!activeLoad) throw Error('Structural reader is disposed or its computation has expired.')
      scope?.check()
      scope?.signal?.throwIfAborted()
    }
    return {
      dispose() { activeLoad = undefined; scope = undefined },
      references: async (options: TypeScriptReferenceQuery) => {
        check()
        const index = await activeLoad!()
        check()
        const name = 'name' in options.target ? options.target.name : 'default'
        const selected = index.selections[name] ?? { keys: [`missing:${name}`], rows: [] }
        scope?.selection(index.certificate ?? index.revision, ['coverage', ...selected.keys])
        return { references: selected.rows.map(path => ({ path })), evidence: [],
          scope: { paths: [], declarationFiles: false, externalSources: false },
          completeness: { kind: selected.completeness ?? 'complete' } }
      },
    }
  },
}))

afterEach(() => vi.restoreAllMocks())

const capabilities = ['typescript.body', 'typescript.source'].map(capability => ({
  capability, completeness: { kind: 'complete' },
})) as CapabilityStatus[]
const query = (id: string) => ({ generation: { id }, capabilities: async () => capabilities }) as unknown as AnalysisQuery
const initial = (selections: FixtureIndex['selections'] = {}): FixtureIndex => ({
  revision: { token: {}, changed: new Set(), selection: 'typescript.structure/v1' }, selections,
})
const next = (before: FixtureIndex, changed: readonly string[], selections = before.selections,
  extra: Partial<FixtureIndex> = {}): FixtureIndex => ({
  revision: { token: {}, parent: before.revision.token, changed: new Set(changed), selection: 'typescript.structure/v1' },
  selections, ...extra,
})
const structuralLoad = (index: FixtureIndex) => async () => index as unknown as StructuralIndex
const bodyLoad = () => vi.fn(async (): Promise<ValueIndex> => { throw Error('Structural reads must not load function bodies.') })
const referencePaths = async (read: TypeScriptSemanticReader, name = 'api') =>
  (await (await read.structure()).references({ target: { path: '/api.ts', name } })).references.map(row => row.path)
const occurrence = deriveAnalysisId('occurrence', 'structural-computation', 'missing')
const valueKind = async (read: TypeScriptSemanticReader) => (await (await read.values()).value(occurrence).resolve()).kind

describe('tracked structural computation', () => {
  it('loads only its read domain and reuses through unrelated revisions, including undemanded variants', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const a = initial({ api: { keys: ['references:api'], rows: ['/consumer.ts'] }, other: { keys: ['references:other'], rows: [] } })
    const b = next(a, ['references:unrelated']), c = next(b, ['references:another'])
    const executions: string[] = []
    const observe = async (read: TypeScriptSemanticReader, name: string) => { executions.push(name); return referencePaths(read, name) }
    const run = async (id: string, index: FixtureIndex, name: string) => {
      const snapshot = query(id); cache.committed(snapshot.generation)
      return cache.run(snapshot, loadBody, observe, name, () => {}, undefined, structuralLoad(index))
    }
    try {
      expect(await run('a', a, 'api')).toEqual(['/consumer.ts'])
      expect(await run('a', a, 'other')).toEqual([])
      expect(await run('b', b, 'api')).toEqual(['/consumer.ts'])
      expect(await run('c', c, 'other')).toEqual([])
      expect(await run('c', c, 'api')).toEqual(['/consumer.ts'])
      expect(executions).toEqual(['api', 'other'])
      expect(loadBody).not.toHaveBeenCalled()
      expect(values.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
      cache.close(); expect(values.bytes).toBeLessThan(64 * 1024)
    } finally { cache.close(); values.close() }
  })

  it('invalidates an absent selection, additions, deletions, canonical changes and coverage downgrades', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const a = initial(), b = next(a, ['missing:api'], { api: { keys: ['references:api'], rows: ['/one.ts'] } })
    const c = next(b, ['references:api'], { api: { keys: ['references:api'], rows: ['/one.ts', '/two.ts'] } })
    const d = next(c, ['references:api'], { api: { keys: ['references:api'], rows: ['/two.ts'] } })
    const e = next(d, ['references:api'], { api: { keys: ['references:api'], rows: ['/new-canonical.ts'] } })
    const f = next(e, ['coverage'], { api: { keys: ['references:api'], rows: ['/new-canonical.ts'], completeness: 'partial' } })
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => {
      executions++
      return (await read.structure()).references({ target: { path: '/api.ts', name: 'api' } })
    }
    try {
      const expected = [[], ['/one.ts'], ['/one.ts', '/two.ts'], ['/two.ts'], ['/new-canonical.ts'], ['/new-canonical.ts']]
      for (const [position, index] of [a, b, c, d, e, f].entries()) {
        const snapshot = query(String(position)); cache.committed(snapshot.generation)
        const run = () => cache.run(snapshot, loadBody, observe, null, () => {}, undefined, structuralLoad(index))
        const result = await run()
        expect(result.references.map(row => row.path)).toEqual(expected[position])
        expect(result.completeness.kind).toBe(position === 5 ? 'partial' : 'complete')
        expect(await run()).toEqual(result)
      }
      expect(executions).toBe(6)
      expect(loadBody).not.toHaveBeenCalled()
    } finally { cache.close(); values.close() }
  })

  it('leaves the value domain lazy even with resident value computations', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const body = IndexedValues.empty().update([], [], true, capabilities), a = initial()
    const first = query('first'); cache.committed(first.generation)
    const valueObserve = async (read: TypeScriptSemanticReader) => valueKind(read)
    const structuralObserve = async (read: TypeScriptSemanticReader) => referencePaths(read)
    try {
      expect(await cache.run(first, async () => body, valueObserve, null, () => {})).toBe('unknown')
      const loadBody = bodyLoad()
      expect(await cache.run(first, loadBody, structuralObserve, null, () => {}, undefined, structuralLoad(a))).toEqual([])
      const second = query('second'); cache.committed(second.generation)
      expect(await cache.run(second, loadBody, structuralObserve, null, () => {}, undefined, structuralLoad(next(a, [])))).toEqual([])
      expect(loadBody).not.toHaveBeenCalled()
    } finally { cache.close(); values.close() }
  })

  it('tracks mixed computations against both independent revisions', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const body = IndexedValues.empty().update([], [], true, capabilities)
    const bodyNext: ValueIndex = { ...body, dependency: body.dependency.bind(body), revision: {
      token: {}, parent: body.revision.token, changed: new Set([`occurrence:${occurrence}`]), selection: 'typescript.calls/v1',
    } }
    const a = initial({ api: { keys: ['references:api'], rows: ['/before.ts'] } })
    const b = next(a, ['references:api'], { api: { keys: ['references:api'], rows: ['/after.ts'] } }), c = next(b, [])
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => { executions++; return { kind: await valueKind(read), paths: await referencePaths(read) } }
    try {
      for (const [position, [structure, bodyIndex]] of ([[a, body], [b, body], [c, bodyNext]] as const).entries()) {
        const snapshot = query(String(position)); cache.committed(snapshot.generation)
        const run = () => cache.run(snapshot, async () => bodyIndex, observe, null, () => {}, undefined, structuralLoad(structure))
        expect(await run()).toEqual({ kind: 'unknown', paths: [position === 0 ? '/before.ts' : '/after.ts'] })
        await run()
      }
      expect(executions).toBe(3)
    } finally { cache.close(); values.close() }
  })

  it.each(['discontinuity', 'certificate'] as const)('does not retain an uncertified %s read', async mode => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const a = initial(), b = next(a, ['missing:api'], a.selections, mode === 'discontinuity'
      ? { revision: { ...a.revision, token: {}, parent: {} } }
      : { certificate: { ...a.revision, token: {} } })
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => { executions++; return referencePaths(read) }
    try {
      const first = query('first'); cache.committed(first.generation)
      await cache.run(first, loadBody, observe, null, () => {}, undefined, structuralLoad(a))
      const second = query('second'); cache.committed(second.generation)
      for (let attempt = 0; attempt < 2; attempt++) await cache.run(second, loadBody, observe, null, () => {}, undefined, structuralLoad(b))
      expect(executions).toBe(mode === 'discontinuity' ? 2 : 3)
    } finally { cache.close(); values.close() }
  })

  it('never lets an old pin retire a current result or move the reconciliation frontier backward', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const a = initial({ api: { keys: ['references:api'], rows: ['/old.ts'] } })
    const b = next(a, ['references:api'], { api: { keys: ['references:api'], rows: ['/current.ts'] } })
    const first = query('first'), second = query('second')
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => { executions++; return referencePaths(read) }
    const run = (snapshot: AnalysisQuery, index: FixtureIndex) => cache.run(snapshot, loadBody, observe, null, () => {}, undefined, structuralLoad(index))
    try {
      cache.committed(first.generation); expect(await run(first, a)).toEqual(['/old.ts'])
      cache.committed(second.generation); expect(await run(second, b)).toEqual(['/current.ts'])
      expect(await run(first, a)).toEqual(['/old.ts'])
      expect(await run(second, b)).toEqual(['/current.ts'])
      expect(executions).toBe(3)
    } finally { cache.close(); values.close() }
  })

  it('checks disposal before cache hits and expires escaped structural readers', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const snapshot = query('first'); cache.committed(snapshot.generation)
    let escaped: Awaited<ReturnType<TypeScriptSemanticReader['structure']>> | undefined, outer: TypeScriptSemanticReader | undefined, disposed = false
    const check = () => { if (disposed) throw Error('Snapshot disposed.') }
    const observe = async (read: TypeScriptSemanticReader) => { outer = read; escaped = await read.structure(); return referencePaths(read) }
    try {
      await cache.run(snapshot, loadBody, observe, null, check, undefined, structuralLoad(initial()))
      await expect(escaped!.references({ target: { path: '/api.ts', name: 'api' } })).rejects.toThrow('disposed or its computation has expired')
      await expect(outer!.structure()).rejects.toThrow('only be used during its computation')
      await expect(outer!.values()).rejects.toThrow('only be used during its computation')
      await expect(outer!.calls()).rejects.toThrow('only be used during its computation')
      expect(loadBody).not.toHaveBeenCalled()
      disposed = true
      await expect(cache.run(snapshot, loadBody, observe, null, check, undefined, structuralLoad(initial()))).rejects.toThrow('Snapshot disposed.')
    } finally { cache.close(); values.close() }
  })

  it('releases pending construction on cancellation, handles late loader failure, and retries independently', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const snapshot = query('first'); cache.committed(snapshot.generation)
    const controller = new AbortController(), baseline = values.bytes
    let reject!: (error: Error) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<StructuralIndex>((_resolve, fail) => { reject = fail })
    const observe = async (read: TypeScriptSemanticReader) => referencePaths(read)
    try {
      const run = cache.run(snapshot, loadBody, observe, null, () => {}, controller.signal, () => { entered(); return pending })
      await started
      controller.abort(Error('Stopped.'))
      await expect(run).rejects.toThrow('Stopped.')
      expect(values.bytes).toBe(baseline)
      reject(Error('Late loader failure.'))
      expect(await cache.run(snapshot, loadBody, observe, null, () => {}, undefined, structuralLoad(initial()))).toEqual([])
    } finally { cache.close(); values.close() }
  })

  it('does not poison admission after a loader fails', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const snapshot = query('first'); cache.committed(snapshot.generation)
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => { executions++; return referencePaths(read) }
    try {
      await expect(cache.run(snapshot, loadBody, observe, null, () => {}, undefined, async () => { throw Error('Unavailable.') })).rejects.toThrow('Unavailable.')
      const a = initial(), load = vi.fn(structuralLoad(a))
      await cache.run(snapshot, loadBody, observe, null, () => {}, undefined, load)
      await cache.run(snapshot, loadBody, observe, null, () => {}, undefined, load)
      expect(executions).toBe(2)
      expect(loadBody).not.toHaveBeenCalled()
    } finally { cache.close(); values.close() }
  })

  it.each(['values', 'structure'] as const)('does not cache a fallback after its callback catches a %s loader failure', async domain => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const snapshot = query('first'); cache.committed(snapshot.generation)
    const body = IndexedValues.empty().update([], [], true, capabilities)
    const structure = initial({ api: { keys: ['references:api'], rows: ['/consumer.ts'] } })
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => {
      executions++
      try { return domain === 'values' ? await valueKind(read) : await referencePaths(read) }
      catch { return 'fallback' }
    }
    const failed = async (): Promise<never> => { throw Error('Transient loader failure.') }
    try {
      expect(await cache.run(snapshot, domain === 'values' ? failed : async () => body, observe, null, () => {},
        undefined, domain === 'structure' ? failed : structuralLoad(structure))).toBe('fallback')
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await cache.run(snapshot, async () => body, observe, null, () => {}, undefined, structuralLoad(structure)))
          .toEqual(domain === 'values' ? 'unknown' : ['/consumer.ts'])
      }
      expect(executions).toBe(2)
    } finally { cache.close(); values.close() }
  })

  it('shares the original memory envelope and falls back when admission cannot fit', async () => {
    const values = new ValueResolutionCache(Infinity, 4096), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const snapshot = query('first'); cache.committed(snapshot.generation)
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader) => { executions++; return referencePaths(read) }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await cache.run(snapshot, loadBody, observe, null, () => {}, undefined, structuralLoad(initial()))).toEqual([])
        expect(values.bytes).toBeLessThanOrEqual(4096)
      }
      expect(executions).toBe(2)
      cache.close(); expect(values.bytes).toBeLessThan(4096)
    } finally { cache.close(); values.close() }
  })

  it('retires stale structural variants before a new variant can evict an independent proof', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values), loadBody = bodyLoad()
    const a = initial({ api: { keys: ['references:api'], rows: [] } }), b = next(a, ['references:api'])
    const proof = { kind: 'known' as const, value: 'independent', evidence: [],
      limits: { maximumSteps: 10, maximumDepth: 10, maximumAlternatives: 10 } }
    const payload = 'x'.repeat(4 * 1024 * 1024)
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader, variant: string) => {
      executions++
      if (variant === 'new') expect(values.get('independent', () => true)).toBe(proof)
      return { variant, paths: await referencePaths(read), payload }
    }
    try {
      const first = query('first'); cache.committed(first.generation)
      await cache.run(first, loadBody, observe, 'old', () => {}, undefined, structuralLoad(a))
      values.put('independent', proof, 3 * 1024 * 1024)
      const second = query('second'); cache.committed(second.generation)
      await cache.run(second, loadBody, observe, 'new', () => {}, undefined, structuralLoad(b))
      await cache.run(second, loadBody, observe, 'new', () => {}, undefined, structuralLoad(b))
      expect(values.get('independent', () => true)).toBe(proof)
      expect(values.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
      expect(executions).toBe(2)
      expect(loadBody).not.toHaveBeenCalled()
    } finally { cache.close(); values.close() }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { combineCompleteness, type Completeness, type SourceSpan } from '../analysis/facts/index.ts'
import { deriveAnalysisId, type SymbolId } from '../analysis/identity/index.ts'
import type { AnalysisQuery, CapabilityStatus } from '../analysis/query/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { SemanticComputationCache } from '../analysis/typescript/project/compute.ts'
import type { TypeScriptSemanticReader } from '../analysis/typescript/project/model.ts'
import type { TypeScriptStructureFact } from '../analysis/typescript/structure/model.ts'
import { StructuralIndex, structuralKey } from '../analysis/typescript/structure/owner.ts'
import { createTypeScriptStructuralReader } from '../analysis/typescript/structure/reader.ts'
import { ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import type { ValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'

const namespace = 'typescript.structure', complete: Completeness = { kind: 'complete' }
const capabilities: CapabilityStatus[] = [{ capability: namespace, completeness: complete }]
const identity = (name: string) => deriveAnalysisId('symbol', 'structural-navigation', name)
const local = identity('local'), outer = identity('outer'), other = identity('other')
const partial: Completeness = { kind: 'partial', reasons: [{ code: 'UNRESOLVED_SYMBOL', message: 'One site has no canonical target.', effective: {} }] }

function file(path: string, version = '1', overrides: Partial<TypeScriptStructureFact> = {}): TypeScriptFact<'structure'> {
  const payload: TypeScriptStructureFact = {
    source: deriveAnalysisId('source', 'structural-navigation', path),
    revision: deriveAnalysisId('source-revision', 'structural-navigation', { path, version }), logicalPath: path, textDigest: version,
    symbols: [], exports: [], references: [], dependencies: [],
    completeness: { exports: complete, references: complete, dependencies: complete }, ...overrides,
  }
  return { id: deriveAnalysisId('fact', namespace, payload), generation: deriveAnalysisId('generation', 'structural-navigation', 'fixture'),
    namespace, schemaVersion: 1, kind: 'structure', subject: payload.source, payload,
    completeness: Object.values(payload.completeness).reduce(combineCompleteness, complete),
    provenance: { pass: deriveAnalysisId('pass', 'structural-navigation', {}), passVersion: '1', evidence: [], inputs: [] } }
}
const span = (owner: TypeScriptFact<'structure'>, start: number, end: number): SourceSpan => ({
  source: owner.payload.source, revision: owner.payload.revision, start, end,
})
const metadata = (symbol: SymbolId, declarations: readonly SourceSpan[] = []) => ({
  symbol, name: symbol === local ? '#local' : 'other', declarations, generationScoped: false,
})
const fresh = (files: readonly TypeScriptFact<'structure'>[]) => new StructuralIndex().update(files, [], capabilities)
const read = (index: StructuralIndex) => createTypeScriptStructuralReader(async () => index)
function contents(index: StructuralIndex) {
  return {
    sources: [...index.sources].map(([source, fact]) => [source, fact.payload.logicalPath, fact.id]).sort(),
    files: [...index.files].map(([path, fact]) => [path, fact.id, fact.payload]).sort(),
    facts: [...index.facts].map(([id, fact]) => [id, fact.payload.logicalPath]).sort(),
    references: [...index.references].flatMap(([symbol, posting]) => [...posting].map(([path, entries]) =>
      [symbol, path, entries.map(entry => entry.reference)])).sort(),
  }
}

describe('structural source identity ownership', () => {
  it('shares untouched source owners and retires old identities without changing pinned indexes', () => {
    const selected = file('selected.ts'), unrelated = file('unrelated.ts'), a = fresh([selected, unrelated])
    const edited = file('unrelated.ts', '2'), b = a.update([edited], [unrelated.id], capabilities)
    expect(b.sources.get(selected.payload.source)).toBe(selected)
    expect(b.revision.changed).not.toContain(structuralKey.source(selected.payload.source))
    const relocated = file('selected.ts', '2', { source: deriveAnalysisId('source', 'structural-navigation', 'replacement') })
    const c = b.update([relocated], [selected.id], capabilities)
    expect(c.sources.has(selected.payload.source)).toBe(false)
    expect(c.sources.get(relocated.payload.source)).toBe(relocated)
    expect(c.revision.changed).toContain(structuralKey.source(selected.payload.source))
    expect(c.revision.changed).toContain(structuralKey.source(relocated.payload.source))
    expect(a.sources.get(selected.payload.source)).toBe(selected)
    expect(contents(c)).toEqual(contents(fresh([relocated, edited])))
    const d = c.update([], [relocated.id], capabilities)
    expect(d.sources.has(relocated.payload.source)).toBe(false)
    expect(contents(d)).toEqual(contents(fresh([edited])))
  })

  it('rejects duplicate SourceId owners atomically during fresh and incremental admission', () => {
    const a = file('a.ts'), alias = file('b.ts', '1', { source: a.payload.source }), before = fresh([a])
    expect(() => fresh([a, alias])).toThrow('Duplicate structural source identity')
    expect(() => before.update([alias], [], capabilities)).toThrow('Duplicate structural source identity')
    expect(before.sources.get(a.payload.source)).toBe(a)
    expect(before.files.has('b.ts')).toBe(false)
  })

  it('preserves both new owners when source identities swap in one transaction', () => {
    const a = file('a.ts'), b = file('b.ts'), before = fresh([a, b])
    const nextA = file('a.ts', '2', { source: b.payload.source }), nextB = file('b.ts', '2', { source: a.payload.source })
    for (const upserts of [[nextA, nextB], [nextB, nextA]]) {
      const next = before.update(upserts, [a.id, b.id], capabilities)
      expect(next.sources.get(a.payload.source)).toBe(nextB)
      expect(next.sources.get(b.payload.source)).toBe(nextA)
      expect(contents(next)).toEqual(contents(fresh(upserts)))
    }
  })

  it('retires old paths, source joins and postings when a reused FactId moves its contribution', () => {
    const a = file('old.ts', '1', { symbols: [metadata(local)], references: [{ symbol: local, kind: 'value', start: 2, end: 7 }] })
    const replacement = { ...file('new.ts', '2', { symbols: [metadata(other)], references: [{ symbol: other, kind: 'value', start: 8, end: 13 }] }), id: a.id }
    const before = fresh([a]), after = before.update([replacement], [], capabilities)
    expect(after.files.has('old.ts')).toBe(false)
    expect(after.sources.has(a.payload.source)).toBe(false)
    expect(after.sources.get(replacement.payload.source)).toBe(replacement)
    expect(after.references.has(local)).toBe(false)
    expect(contents(after)).toEqual(contents(fresh([replacement])))
    expect(before.files.get('old.ts')).toBe(a)
    expect(before.references.get(local)?.get('old.ts')).toHaveLength(1)
  })
})

describe('location-first static navigation', () => {
  it('navigates private local symbols without exports and reuses the canonical reference postings', async () => {
    const owner = file('private.ts')
    const selected = file('private.ts', '1', { symbols: [metadata(local, [span(owner, 0, 80)])], references: [
      { symbol: local, kind: 'declaration', start: 10, end: 16, binding: '#local' },
      { symbol: local, kind: 'value', start: 31, end: 37 },
    ] })
    const reader = read(fresh([selected])), cursor = { path: 'private.ts', offset: 33 }
    const result = await reader.symbolAt(cursor)
    expect(result).toMatchObject({ target: { kind: 'resolved', symbols: [local] }, completeness: complete,
      scope: { paths: ['private.ts'], declarationFiles: false, externalSources: false },
      source: { source: selected.payload.source, revision: selected.payload.revision, logicalPath: 'private.ts', textDigest: '1' },
      symbols: [{ symbol: local, name: '#local', declarations: [{ path: 'private.ts', span: span(selected, 0, 80) }] }],
      sites: [{ symbol: local, path: 'private.ts', kind: 'value', span: span(selected, 31, 37) }], evidence: [selected.id] })
    expect(await reader.references({ target: cursor })).toEqual(await reader.references({ target: { symbol: local } }))
    expect((await reader.references({ target: cursor })).references.map(site => site.kind)).toEqual(['value'])
    expect((await reader.references({ target: cursor, includeDeclarations: true })).references.map(site => site.kind)).toEqual(['declaration', 'value'])
  })

  it('selects the shortest containing token regardless of AST order and uses half-open offsets', async () => {
    const selected = file('nested.ts', '1', { symbols: [metadata(local), metadata(outer)], references: [
      { symbol: outer, kind: 'value', start: 0, end: 50 },
      { symbol: local, kind: 'type', start: 20, end: 25 },
      { symbol: outer, kind: 'type', start: 10, end: 40 },
    ] })
    const reader = read(fresh([selected]))
    expect(await reader.symbolAt({ path: 'nested.ts', offset: 20 })).toMatchObject({ target: { kind: 'resolved', symbols: [local] }, sites: [{ span: { start: 20, end: 25 } }] })
    expect(await reader.symbolAt({ path: 'nested.ts', offset: 25 })).toMatchObject({ target: { kind: 'resolved', symbols: [outer] }, sites: [{ span: { start: 10, end: 40 } }] })
    expect(await reader.symbolAt({ path: 'nested.ts', offset: 50 })).toMatchObject({ target: { kind: 'missing' }, sites: [], completeness: complete })
  })

  it('retains equal-width candidates and exposes ambiguity and unresolved narrowest sites', async () => {
    const known = file('known.ts', '1', { symbols: [metadata(local), metadata(other)], references: [
      { symbol: other, kind: 'type', start: 5, end: 10 }, { symbol: local, kind: 'value', start: 5, end: 10 },
    ] })
    const ambiguous = await read(fresh([known])).symbolAt({ path: 'known.ts', offset: 7 })
    expect(ambiguous.sites).toHaveLength(2)
    expect(ambiguous.symbols.map(symbol => symbol.symbol)).toEqual([local, other].sort())
    expect(ambiguous.completeness).toMatchObject({ kind: 'partial', reasons: [expect.objectContaining({ code: 'STRUCTURAL_SYMBOL_SITE_AMBIGUOUS' })] })
    const unknown = file('unknown.ts', '1', { symbols: [metadata(outer)], references: [
      { symbol: outer, kind: 'value', start: 0, end: 20 }, { kind: 'value', start: 5, end: 10 },
    ], completeness: { exports: complete, references: partial, dependencies: complete } })
    expect(await read(fresh([unknown])).symbolAt({ path: 'unknown.ts', offset: 7 })).toMatchObject({ target: { kind: 'unavailable' }, symbols: [], sites: [{ span: { start: 5, end: 10 } }], completeness: partial })
    const mixed = file('mixed.ts', '1', { symbols: [metadata(local)], references: [
      { symbol: local, kind: 'value', start: 5, end: 10 }, { kind: 'type', start: 5, end: 10 },
    ], completeness: { exports: complete, references: partial, dependencies: complete } })
    expect(await read(fresh([mixed])).symbolAt({ path: 'mixed.ts', offset: 7 })).toMatchObject({ target: { kind: 'unavailable' }, symbols: [{ symbol: local }], completeness: partial })
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid offset %s for both position entrypoints', async offset => {
    const load = vi.fn(async () => fresh([])), reader = createTypeScriptStructuralReader(load)
    await expect(reader.symbolAt({ path: 'a.ts', offset })).rejects.toBeInstanceOf(TypeError)
    await expect(reader.references({ target: { path: 'a.ts', offset } })).rejects.toBeInstanceOf(TypeError)
    expect(load).not.toHaveBeenCalled()
  })

  it('distinguishes loaded empty sources, missing inventory and stale cursor revisions', async () => {
    const empty = file('empty.ts'), reader = read(fresh([empty]))
    expect(await reader.symbolAt({ path: 'empty.ts', offset: 0 })).toMatchObject({ target: { kind: 'missing' }, completeness: complete, sites: [], symbols: [] })
    expect(await reader.symbolAt({ path: 'absent.ts', offset: 0 })).toMatchObject({ target: { kind: 'unavailable' }, completeness: { kind: 'unavailable' } })
    // Complete local rows cannot prove absence while the provider retains
    // unattributed uncertainty about the selected structural capability.
    const unavailable: Completeness = { kind: 'unavailable', reasons: [{ code: 'PROVIDER_UNAVAILABLE', message: 'Provider inventory is unavailable.', retryable: true }] }
    for (const coverage of [partial, unavailable]) {
      const uncertain = read(new StructuralIndex().update([empty], [], [{ capability: namespace, completeness: coverage }]))
      const cursor = { path: 'empty.ts', offset: 0 }
      expect(await uncertain.symbolAt(cursor)).toMatchObject({ target: { kind: 'unavailable' }, completeness: coverage, sites: [], symbols: [] })
      expect(await uncertain.references({ target: cursor })).toMatchObject({ target: { kind: 'unavailable' }, completeness: coverage, references: [] })
    }
    const revision = deriveAnalysisId('source-revision', 'structural-navigation', 'old')
    const target = { path: 'empty.ts', offset: 0, revision }
    const stale = { kind: 'stale', expectedRevision: revision, actualRevision: empty.payload.revision }
    expect(await reader.symbolAt(target)).toMatchObject({ target: stale, symbols: [], sites: [], source: { revision: empty.payload.revision }, completeness: { kind: 'unavailable' } })
    expect(await reader.references({ target })).toMatchObject({ target: stale, references: [], completeness: { kind: 'unavailable' } })
  })

  it('joins only matching declaration source revisions and certifies missing source joins', async () => {
    const available = file('definition.ts'), missing = file('not-loaded.ts'), old = file('changed.ts'), newer = file('changed.ts', '2')
    const selected = file('use.ts', '1', { symbols: [metadata(local, [span(available, 1, 18), span(missing, 2, 20), span(old, 3, 22)])],
      references: [{ symbol: local, kind: 'value', start: 5, end: 10 }] })
    const index = fresh([selected, available, newer]), selection = vi.fn()
    const reader = createTypeScriptStructuralReader(async () => index, { check() {}, selection })
    const result = await reader.symbolAt({ path: 'use.ts', offset: 6 })
    expect(result.symbols[0]?.declarations).toEqual([{ path: 'definition.ts', span: span(available, 1, 18) }])
    expect(result.completeness).toMatchObject({ kind: 'partial', reasons: expect.arrayContaining([expect.objectContaining({ code: 'STRUCTURAL_DECLARATION_SOURCE_UNAVAILABLE' })]) })
    expect(result.evidence).toEqual([selected.id, available.id].sort())
    const keys = selection.mock.calls[0]![1] as readonly string[]
    for (const owner of [available, missing, old]) expect(keys).toContain(structuralKey.source(owner.payload.source))
  })

  it('captures cursor options before a lazy load and honors cancellation and disposal before publication', async () => {
    const selected = file('a.ts', '1', { symbols: [metadata(local)], references: [{ symbol: local, kind: 'value', start: 1, end: 5 }] })
    const index = fresh([selected])
    let finish!: (index: StructuralIndex) => void
    const gate = new Promise<StructuralIndex>(resolve => { finish = resolve })
    const reader = createTypeScriptStructuralReader(() => gate), cursor = { path: 'a.ts', offset: 2 }
    const result = reader.symbolAt(cursor); cursor.path = 'other.ts'; cursor.offset = 100
    finish(index)
    expect(await result).toMatchObject({ target: { kind: 'resolved', symbols: [local] }, scope: { paths: ['a.ts'] } })
    reader.dispose()
    await expect(reader.symbolAt({ path: 'a.ts', offset: 2 })).rejects.toThrow('disposed')
    const controller = new AbortController(), cancelled = createTypeScriptStructuralReader(async () => { controller.abort(Error('Stopped.')); return index })
    await expect(cancelled.symbolAt({ path: 'a.ts', offset: 2, signal: controller.signal })).rejects.toThrow('Stopped.')
    const disposed = createTypeScriptStructuralReader(async () => { disposed.dispose(); return index })
    await expect(disposed.symbolAt({ path: 'a.ts', offset: 2 })).rejects.toThrow('disposed')
  })
})

describe('tracked location navigation', () => {
  it('reuses unrelated edits but invalidates absent, added, revised and deleted declaration joins without body loads', async () => {
    const definition = file('definition.ts'), newer = file('definition.ts', '2'), unrelated = file('unrelated.ts')
    const selected = file('use.ts', '1', { symbols: [metadata(local, [span(definition, 0, 20)])], references: [{ symbol: local, kind: 'value', start: 3, end: 8 }] })
    const a = fresh([selected]), b = a.update([unrelated], [], capabilities), c = b.update([definition], [], capabilities)
    const d = c.update([newer], [definition.id], capabilities), e = d.update([], [newer.id], capabilities)
    const files = [[selected], [selected, unrelated], [selected, unrelated, definition], [selected, unrelated, newer], [selected, unrelated]]
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const body = vi.fn(async (): Promise<ValueIndex> => { throw Error('Position queries must not load function bodies.') })
    let executions = 0
    const observe = async (reader: TypeScriptSemanticReader) => { executions++; return (await reader.structure()).symbolAt({ path: 'use.ts', offset: 4 }) }
    try {
      for (const [step, index] of [a, b, c, d, e].entries()) {
        const query = { generation: { id: deriveAnalysisId('generation', 'structural-navigation-cache', step) }, capabilities: async () => capabilities } as unknown as AnalysisQuery
        cache.committed(query.generation)
        const run = () => cache.run(query, body, observe, null, () => {}, undefined, async () => index)
        const result = await run()
        expect(result).toEqual(await read(fresh(files[step]!)).symbolAt({ path: 'use.ts', offset: 4 }))
        expect(await run()).toEqual(result)
      }
      expect(executions).toBe(4)
      expect(body).not.toHaveBeenCalled()
      expect(values.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    } finally { cache.close(); values.close() }
  })

  it('invalidates an empty selection and a cursor revision when the selected source changes with a reused FactId', async () => {
    const empty = file('selected.ts'), changed = { ...file('selected.ts', '2', { symbols: [metadata(local)], references: [{ symbol: local, kind: 'value', start: 1, end: 5 }] }), id: empty.id }
    const a = fresh([empty]), b = a.update([changed], [], capabilities)
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const body = vi.fn(async (): Promise<ValueIndex> => { throw Error('Body load is forbidden.') })
    let executions = 0
    const observe = async (reader: TypeScriptSemanticReader, checked: boolean) => {
      executions++
      return (await reader.structure()).symbolAt({ path: 'selected.ts', offset: 2, ...(checked ? { revision: empty.payload.revision } : {}) })
    }
    try {
      for (const [step, index] of [a, b].entries()) {
        const query = { generation: { id: deriveAnalysisId('generation', 'structural-navigation-missing', step) }, capabilities: async () => capabilities } as unknown as AnalysisQuery
        cache.committed(query.generation)
        for (const checked of [false, true]) {
          const result = await cache.run(query, body, observe, checked, () => {}, undefined, async () => index)
          expect(result).toEqual(await read(fresh([step ? changed : empty])).symbolAt({ path: 'selected.ts', offset: 2, ...(checked ? { revision: empty.payload.revision } : {}) }))
          expect(result.target.kind).toBe(step === 0 ? 'missing' : checked ? 'stale' : 'resolved')
        }
      }
      expect(executions).toBe(4)
      expect(body).not.toHaveBeenCalled()
    } finally { cache.close(); values.close() }
  })
})

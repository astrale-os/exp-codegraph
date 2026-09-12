import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Completeness } from '../analysis/facts/index.ts'
import { deriveAnalysisId, type SourceId } from '../analysis/identity/index.ts'
import type { AnalysisQuery, CapabilityStatus } from '../analysis/query/index.ts'
import type { FunctionBodyIR, TypeScriptCallQuery } from '../analysis/typescript/body/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { validateTypeScriptFactPayload } from '../analysis/typescript/facts/validate.ts'
import { createCallProjection } from '../analysis/typescript/value/symbolic/calls.ts'
import { IndexedValues, type IndexedFact, type ValueIndexRevision } from '../analysis/typescript/value/symbolic/facts.ts'
import { CALL_SELECTION, callSelectionKey as key } from '../analysis/typescript/value/symbolic/selection.ts'
import { ValueIndexTable } from '../analysis/typescript/value/symbolic/table.ts'

const complete: Completeness = { kind: 'complete' }
const limited: Completeness = { kind: 'partial', reasons: [{ code: 'CFG_NESTED_SCOPE_UNSUPPORTED', message: 'Nested scope omitted.', effective: { scopes: 1 } }] }
const flow: Completeness = { kind: 'partial', reasons: [{ code: 'CFG_SWITCH_PARTIAL', message: 'Switch topology omitted.', effective: {} }] }
const unavailable: Completeness = { kind: 'unavailable', reasons: [{ code: 'MISSING', message: 'Producer unavailable.', retryable: true }] }
const capabilities = (body = complete, source = complete): readonly CapabilityStatus[] => [
  { capability: 'typescript.body', completeness: body }, { capability: 'typescript.source', completeness: source },
]
const sourceId = (name: string) => deriveAnalysisId('source', 'selection-fixture', name)
const occurrenceId = (name: string) => deriveAnalysisId('occurrence', 'selection-fixture', name)
const generation = deriveAnalysisId('generation', 'selection-fixture', {})
const span = (source: SourceId, start = 0) => ({ source, revision: deriveAnalysisId('source-revision', 'selection-fixture', source), start, end: start + 1 })

function envelope<Kind extends 'body' | 'source'>(kind: Kind, name: string, subject: string,
  payload: TypeScriptFact<Kind>['payload'], source?: SourceId, completeness = complete): TypeScriptFact<Kind> {
  expect(validateTypeScriptFactPayload(kind, payload)).toEqual([])
  return { id: deriveAnalysisId('fact', 'selection-fixture', { kind, name }), generation, namespace: `typescript.${kind}`,
    schemaVersion: 1, kind, subject, payload, completeness,
    provenance: { pass: deriveAnalysisId('pass', 'selection-fixture', {}), passVersion: '1', inputs: [], evidence: source ? [span(source)] : [] },
  } as TypeScriptFact<Kind>
}
function source(name: string, path = `${name}.ts`, id = sourceId(name)) {
  return envelope('source', name, id, { source: id, revision: span(id).revision, logicalPath: path, textDigest: path, declaration: false, projectOwned: true }, id)
}
function body(name: string, options: { source?: SourceId; provenance?: SourceId | null; owner?: string; site?: string; calls?: boolean; completion?: Completeness; callee?: string } = {}) {
  const ownSource = options.source ?? sourceId(name)
  const owner = deriveAnalysisId('symbol', 'selection-fixture', options.owner ?? name)
  const site = options.site ?? name, call = occurrenceId(`call:${site}`), callee = occurrenceId(options.callee ?? `callee:${site}`)
  const nodes: FunctionBodyIR['occurrences'] = [
    { id: call, owner, syntax: 'CallExpression', kind: 'call', span: span(ownSource) },
    { id: callee, owner, syntax: 'Identifier', kind: 'expression', span: span(ownSource, 1) },
  ]
  const calls: FunctionBodyIR['calls'] = options.calls === false ? [] : [{ occurrence: call, typeArguments: [], arguments: [], bindings: [], callbacks: [], dynamic: true }]
  const ir: FunctionBodyIR = { function: owner, execution: 'sync', parameters: [], occurrences: nodes,
    relations: [{ parent: call, child: callee, role: 'callee' }], blocks: [{ id: 'entry', occurrences: nodes.map((node) => node.id) }], edges: [], definitions: [], calls,
    summary: { function: owner, returns: [], throws: [], captures: [], calls: calls.map(({ occurrence }) => occurrence), escapes: [], recursion: false },
  }
  return envelope('body', name, owner, { body: ir, values: {}, completeness: complete },
    options.provenance === null ? undefined : options.provenance ?? ownSource, options.completion ?? complete)
}
const initial = (facts: readonly IndexedFact[], caps = capabilities()) => IndexedValues.empty().update(facts, [], true, caps)
const query = (caps: readonly CapabilityStatus[]) => ({ capabilities: async () => caps }) as AnalysisQuery
const selectionChanges = (index: IndexedValues) => [...index.revision.changed].filter((value) => value.startsWith('selection:'))

async function inventory(index: IndexedValues, options: TypeScriptCallQuery = {}, caps = capabilities()) {
  const read = vi.fn<(revision: ValueIndexRevision | undefined, keys: readonly string[]) => void>()
  const projected = createCallProjection(query(caps), async () => index)
  const result = await projected(options, read)
  const fallback = createCallProjection(query(caps), async () => ({
    bodies: index.bodies, occurrences: index.occurrences, children: index.children, calls: index.calls,
    sources: index.sources, callsBySource: index.callsBySource,
  }))
  expect(result).toEqual(await fallback(options))
  expect(read).toHaveBeenCalledOnce()
  return { result, keys: read.mock.calls[0]![1], revision: read.mock.calls[0]![0] }
}

afterEach(() => vi.restoreAllMocks())

describe('atomic call selection journal', () => {
  it('records absent paths, explicit intersections and empty filters without treating absence as a global read', async () => {
    const before = initial([])
    expect((await inventory(before, { paths: ['missing.ts', 'missing.ts'] })).keys).toEqual([key.global, key.path('missing.ts'), key.unmapped])
    expect((await inventory(before, { sources: [sourceId('missing')], paths: ['different.ts'] })).keys).toEqual([key.global, key.source(sourceId('missing'))])
    expect((await inventory(before)).keys).toEqual([key.global, key.all])
    const added = before.update([source('missing'), body('missing')], [], false, capabilities())
    expect(added.revision.parent).toBe(before.revision.token)
    expect(added.revision.selection).toBe(CALL_SELECTION)
    expect(added.revision.changed.has(key.path('missing.ts'))).toBe(true)
    expect(added.revision.changed.has(key.global)).toBe(false)
    expect((await inventory(added, { paths: ['missing.ts'] })).result.sites).toHaveLength(1)
    const degraded = added.update([], [], false, capabilities(unavailable))
    for (const options of [{ paths: [] }, { sources: [] }, { paths: ['missing.ts'], sources: [] }]) {
      const read = await inventory(degraded, options, capabilities(unavailable))
      expect(read.keys).toEqual([key.global])
      expect(read.result).toEqual({ sites: [], completeness: unavailable })
    }
    expect(selectionChanges(degraded)).toEqual([key.global])
  })

  it('preserves all sources sharing a path and effective source-fact ownership', async () => {
    const first = source('first', 'shared.ts'), second = source('second', 'shared.ts')
    const firstBody = body('first'), secondBody = body('second')
    const before = initial([first, second, firstBody, secondBody])
    expect((await inventory(before, { paths: ['shared.ts'] })).result.sites).toHaveLength(2)
    const removed = before.update([], [first.id, firstBody.id], false, capabilities())
    expect((await inventory(removed, { paths: ['shared.ts'] })).result.sites).toHaveLength(1)
    const renamed = removed.update([{ ...second, payload: { ...second.payload, logicalPath: 'renamed.ts' } }], [], false, capabilities())
    expect(renamed.revision.changed.has(key.path('shared.ts'))).toBe(true)
    expect(renamed.revision.changed.has(key.path('renamed.ts'))).toBe(true)
    expect((await inventory(renamed, { sources: [sourceId('first')], paths: ['renamed.ts'] })).result.sites).toHaveLength(0)
    expect((await inventory(before, { paths: ['shared.ts'] })).result.sites).toHaveLength(2)

    const overlapping = [source('owner-a', 'a.ts', sourceId('first')), source('owner-b', 'b.ts', sourceId('first'))]
      .sort((left, right) => left.id.localeCompare(right.id))
    const index = initial([...overlapping, firstBody])
    const winningPath = overlapping[1]!.payload.logicalPath
    const maskedRemoved = index.update([], [overlapping[0]!.id], false, capabilities())
    expect(selectionChanges(maskedRemoved)).toEqual([])
    expect((await inventory(maskedRemoved, { paths: [winningPath] })).result.sites).toHaveLength(1)
    const revealed = index.update([], [overlapping[1]!.id], false, capabilities())
    expect((await inventory(revealed, { paths: [overlapping[0]!.payload.logicalPath] })).result.sites).toHaveLength(1)
    expect(revealed.revision.changed.has(key.path(winningPath))).toBe(true)
  })

  it('moves a body-only limitation with provenance even when value fingerprints do not change', async () => {
    const fact = body('limited', { calls: false, completion: limited, provenance: sourceId('first') })
    const caps = capabilities(limited)
    const before = initial([source('first'), source('second'), fact], caps)
    expect((await inventory(before, { paths: ['first.ts'] }, caps)).result.completeness).toEqual(limited)
    expect((await inventory(before, { paths: ['second.ts'] }, caps)).result.completeness).toEqual(complete)
    const moved = { ...fact, provenance: { ...fact.provenance, evidence: [span(sourceId('second'))] } }
    const after = before.update([moved], [], false, caps)
    expect(after.fingerprints.get(`function:${fact.payload.body.function}`)).toBe(before.fingerprints.get(`function:${fact.payload.body.function}`))
    expect(after.revision.changed.has(key.path('first.ts'))).toBe(true)
    expect(after.revision.changed.has(key.path('second.ts'))).toBe(true)
    expect(after.revision.changed.has(key.global)).toBe(false)
    expect((await inventory(after, { paths: ['second.ts'] }, caps)).result.completeness).toEqual(limited)
    const global = after.update([{ ...moved, provenance: { ...moved.provenance, evidence: [] } }], [], false, caps)
    expect(global.revision.changed.has(key.global)).toBe(true)
    expect((await inventory(global, { paths: [] }, caps)).result.completeness).toEqual(limited)
    expect((await inventory(before, { paths: ['second.ts'] }, caps)).result.completeness).toEqual(complete)
  })

  it('counts shared attribution and preserves partial reasons hidden by unavailable contributions', async () => {
    const first = body('a', { calls: false, source: sourceId('shared'), completion: limited })
    const second = body('b', { calls: false, source: sourceId('shared'), completion: limited })
    const caps = capabilities(limited)
    const before = initial([source('shared'), first, second], caps)
    const one = before.update([], [first.id], false, caps)
    expect(one.revision.changed.has(key.global)).toBe(false)
    expect((await inventory(one, { paths: ['absent.ts'] }, caps)).result.completeness).toEqual(complete)
    const none = one.update([], [second.id], false, caps)
    expect(none.revision.changed.has(key.global)).toBe(true)
    expect((await inventory(none, { paths: ['absent.ts'] }, caps)).result.completeness).toEqual(limited)
    const topology = body('flow', { calls: false, completion: flow })
    const flowIndex = initial([topology], capabilities(flow))
    expect((await inventory(flowIndex, {}, capabilities(flow))).result.completeness).toEqual(complete)

    const masked = body('masked', { calls: false, source: sourceId('shared'), completion: unavailable })
    const hidden = before.update([masked], [], false, caps)
    expect((await inventory(hidden, { paths: ['shared.ts'] }, caps)).result.completeness).toEqual(unavailable)
    const restored = hidden.update([], [masked.id], false, caps)
    expect((await inventory(restored, { paths: ['shared.ts'] }, caps)).result.completeness).toEqual(limited)
    expect((await inventory(hidden, { paths: ['shared.ts'] }, caps)).result.completeness).toEqual(unavailable)
  })

  it('counts an unmapped source only once across calls and limitations, including explicit subsets', async () => {
    const fact = body('unknown', { completion: limited })
    const caps = capabilities(limited)
    const before = initial([fact], caps)
    expect(before.callsSelection?.unmapped).toBe(1)
    expect((await inventory(before, { paths: ['unknown.ts'] }, caps)).result.completeness).toMatchObject({
      kind: 'partial', reasons: [expect.objectContaining({ code: 'CALL_SOURCE_SELECTION_UNKNOWN', effective: { sources: 1 } })],
    })
    expect((await inventory(before, { paths: ['unknown.ts'], sources: [sourceId('absent')] }, caps)).result.completeness).toEqual(complete)
    const mapped = before.update([source('unknown')], [], false, caps)
    expect(mapped.callsSelection?.unmapped).toBe(0)
    expect(mapped.revision.changed.has(key.unmapped)).toBe(true)
    expect((await inventory(mapped, { paths: ['unknown.ts'] }, caps)).result.sites).toHaveLength(1)
    const other = body('another', { completion: limited })
    const exchanged = before.update([other], [fact.id], false, caps)
    expect(exchanged.callsSelection?.unmapped).toBe(1)
    expect(exchanged.revision.changed.has(key.unmapped)).toBe(false)
  })

  it('invalidates a call bucket when an overlapping body changes its effective occurrence without owning the call', async () => {
    const facts = [body('overlap-a', { owner: 'shared', site: 'shared', source: sourceId('first') }),
      body('overlap-b', { owner: 'shared', site: 'shared', source: sourceId('second'), calls: false })]
      .sort((left, right) => left.id.localeCompare(right.id))
    const caller = { ...facts[0]!, payload: { ...facts[0]!.payload, body: { ...facts[0]!.payload.body, calls: [{
      occurrence: occurrenceId('call:shared'), typeArguments: [], arguments: [], bindings: [], callbacks: [], dynamic: true,
    }], summary: { ...facts[0]!.payload.body.summary, calls: [occurrenceId('call:shared')] } } } }
    const shadow = { ...facts[1]!, payload: { ...facts[1]!.payload, body: { ...facts[1]!.payload.body, calls: [],
      summary: { ...facts[1]!.payload.body.summary, calls: [] },
    } } }
    const path = caller.payload.body.occurrences[0]!.span.source === sourceId('first') ? 'first.ts' : 'second.ts'
    const before = initial([source('first'), source('second'), caller])
    expect((await inventory(before, { paths: [path] })).result.sites).toHaveLength(1)
    const hidden = before.update([shadow], [], false, capabilities())
    expect(hidden.revision.changed.has(key.path(path))).toBe(true)
    expect((await inventory(hidden, { paths: [path] })).result.sites).toHaveLength(0)
    const restored = hidden.update([], [shadow.id], false, capabilities())
    expect(restored.revision.changed.has(key.path(path))).toBe(true)
    expect((await inventory(restored, { paths: [path] })).result.sites).toHaveLength(1)

    const changedCallee = { ...shadow, payload: { ...shadow.payload, body: { ...shadow.payload.body,
      occurrences: [caller.payload.body.occurrences[0]!, { ...caller.payload.body.occurrences[1]!, id: occurrenceId('callee:replacement') }],
      blocks: [{ id: 'entry', occurrences: [occurrenceId('call:shared'), occurrenceId('callee:replacement')] }],
      relations: [{ parent: occurrenceId('call:shared'), child: occurrenceId('callee:replacement'), role: 'callee' }],
    } } }
    const redirected = before.update([changedCallee], [], false, capabilities())
    expect(redirected.revision.changed.has(key.path(path))).toBe(true)
    expect((await inventory(redirected, { paths: [path] })).result.sites[0]!.callee).toBe(occurrenceId('callee:replacement'))
    expect((await inventory(before, { paths: [path] })).result.sites[0]!.callee).toBe(occurrenceId('callee:shared'))
  })

  it('journals replacement ownership and avoids global iteration for a body-local edit without calls', () => {
    const first = body('owned')
    const before = initial([source('owned'), first])
    const replacement = { ...first, id: deriveAnalysisId('fact', 'selection-fixture', 'replacement') }
    const after = before.update([replacement], [first.id], false, capabilities())
    expect(after.revision.changed.has(key.path('owned.ts'))).toBe(true)
    expect(after.evidence.get(`occurrence:${occurrenceId('call:owned')}`)).toEqual([replacement.id])
    expect(before.evidence.get(`occurrence:${occurrenceId('call:owned')}`)).toEqual([first.id])

    const unrelated = body('unrelated', { calls: false })
    const many = initial([...Array.from({ length: 250 }, (_, i) => body(`many-${i}`)), unrelated])
    const iteration = ValueIndexTable.prototype[Symbol.iterator]
    vi.spyOn(ValueIndexTable.prototype, Symbol.iterator).mockImplementation(function () {
      if (this.size > 100) throw new Error('Global table iteration during a local selection delta.')
      return iteration.call(this)
    })
    const changed = many.update([{ ...unrelated, payload: { ...unrelated.payload, values: {
      [occurrenceId('callee:unrelated')]: { kind: 'known', value: 'changed', evidence: [] },
    } } }], [], false, capabilities())
    expect(selectionChanges(changed)).toEqual([])
  })

  it('refuses selection certification without atomically supplied capabilities and captures option arrays before awaiting', async () => {
    const facts = [source('first'), body('first')]
    const untracked = IndexedValues.empty().update(facts, [], true)
    expect((await inventory(untracked)).revision).toBeUndefined()
    const tracked = untracked.update([], [], false, capabilities())
    expect((await inventory(tracked)).revision).toBe(tracked.revision)
    const dropped = tracked.update([], [])
    expect((await inventory(dropped)).revision).toBeUndefined()
    const paths = ['first.ts']
    let ready!: (index: IndexedValues) => void
    const projection = createCallProjection(query(capabilities()), () => new Promise((resolve) => { ready = resolve }))
    const read = vi.fn()
    const pending = projection({ paths }, read)
    paths[0] = 'second.ts'
    ready(tracked)
    const result = await pending
    expect(result.sites).toHaveLength(1)
    expect(read.mock.calls[0]![1]).toEqual([key.global, key.path('first.ts'), key.unmapped])
  })
})

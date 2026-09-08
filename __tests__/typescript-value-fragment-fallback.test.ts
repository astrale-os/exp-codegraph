import { expect, it } from 'vitest'
import { factHeader, type Fact } from '../analysis/facts/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import type { AnalysisQuery, FactFilter } from '../analysis/query/index.ts'
import type { FunctionBodyIR } from '../analysis/typescript/body/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { validateTypeScriptFactPayload } from '../analysis/typescript/facts/validate.ts'
import { createValueEvaluatorFactory } from '../analysis/typescript/value/symbolic/engine.ts'
import { IndexedValues, type IndexedFact } from '../analysis/typescript/value/symbolic/facts.ts'

const owner = deriveAnalysisId('symbol', 'fragment-fallback', 'owner')
const generation = deriveAnalysisId('generation', 'fragment-fallback', {})
const source = (path: string) => deriveAnalysisId('source', 'fragment-fallback', path)
const occurrence = (name: string) => deriveAnalysisId('occurrence', 'fragment-fallback', name)
const span = (path: string, start = 0) => ({ source: source(path), revision: deriveAnalysisId('source-revision', 'fragment-fallback', path), start, end: start + 1 })
function fact<Kind extends 'body' | 'source'>(kind: Kind, subject: string, payload: TypeScriptFact<Kind>['payload']): TypeScriptFact<Kind> {
  return { id: deriveAnalysisId('fact', 'fragment-fallback', { kind, subject }), generation,
    namespace: `typescript.${kind}`, schemaVersion: 1, kind, subject, completeness: { kind: 'complete' },
    provenance: { pass: deriveAnalysisId('pass', 'fragment-fallback', {}), passVersion: '1', evidence: [span('a.ts')], inputs: [] }, payload,
  } as TypeScriptFact<Kind>
}
function body(nodes: FunctionBodyIR['occurrences']): FunctionBodyIR {
  return { function: owner, execution: 'sync', parameters: [], occurrences: nodes, relations: [],
    blocks: [{ id: 'entry', occurrences: nodes.map(node => node.id) }], edges: [], definitions: [], calls: [],
    summary: { function: owner, returns: [], throws: [], captures: [], calls: [], escapes: [], recursion: false } }
}
function query(facts: readonly Fact[]): AnalysisQuery {
  const selected = (filter: FactFilter = {}) => facts.filter(fact => !filter.namespaces || filter.namespaces.includes(fact.namespace))
  return {
    generation: { id: generation, sequence: 1, universe: deriveAnalysisId('project-universe', 'fragment-fallback', {}),
      producer: { id: deriveAnalysisId('producer', 'fragment-fallback', {}), name: 'fixture', version: '1', protocolVersion: 1 },
      sourceManifest: deriveAnalysisId('source-manifest', 'fragment-fallback', {}), capabilities: ['typescript.body', 'typescript.source'] },
    async dispose() {}, async manifest() { return [] },
    async capabilities() { return ['typescript.body', 'typescript.source'].map(capability => ({ capability, completeness: { kind: 'complete' as const } })) },
    async headers(filter) { return { headers: selected(filter).map(factHeader) } },
    async headersById(ids) { return facts.filter(fact => ids.includes(fact.id)).map(factHeader) },
    async *exportHeaders(filter) { for (const fact of selected(filter)) yield factHeader(fact) },
    async facts(filter) { return { facts: selected(filter) } },
    async factsById(ids) { return facts.filter(fact => ids.includes(fact.id)) },
    async *export(filter) { yield* selected(filter) },
  }
}

it('owns fallback fragments when a mutable external fact replaces its payload and occurrence membership', async () => {
  const original = occurrence('original'), replacement = occurrence('replacement')
  const payload = (id: typeof original, value: number): TypeScriptFact<'body'>['payload'] => ({
    body: body([{ id, kind: 'expression', owner, syntax: 'NumericLiteral', span: span('a.ts') }]),
    values: { [id]: { kind: 'known', value, evidence: [] } }, completeness: { kind: 'complete' },
  })
  const external = { ...fact('body', owner, payload(original, 1)) }
  expect(validateTypeScriptFactPayload('body', external.payload)).toEqual([])
  const before = IndexedValues.empty().update([external], [], true)
  const previous = await createValueEvaluatorFactory(query([external]), undefined, async () => before)()
  const proof = await previous.value(original).resolve()
  expect(proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 1 } })
  expect(Object.isFrozen(external.payload)).toBe(false)

  external.payload = payload(replacement, 2)
  expect(validateTypeScriptFactPayload('body', external.payload)).toEqual([])
  const fresh = IndexedValues.empty().update([external], [], true)
  const updated = before.update([external], [])
  for (const index of [fresh, updated]) {
    expect(index.occurrences.has(original)).toBe(false)
    expect(index.occurrences.has(replacement)).toBe(true)
    const evaluator = await createValueEvaluatorFactory(query([external]), undefined, async () => index)()
    expect(evaluator.canReuse(proof)).toBe(false)
    expect(await evaluator.value(replacement).resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 2 } })
  }
  expect(await previous.value(original).resolve()).toEqual(proof)
  expect(before.occurrences.has(replacement)).toBe(false)
  expect(Object.isFrozen(external.payload)).toBe(false)
})

it('keeps calls from every source in a valid generic body when selecting an inventory', async () => {
  const nodes = ['a.ts', 'b.ts'].flatMap(path => [
    { id: occurrence(`call:${path}`), kind: 'call' as const, syntax: 'CallExpression', owner, span: span(path) },
    { id: occurrence(`callee:${path}`), kind: 'expression' as const, syntax: 'Identifier', owner, span: span(path, 1) },
  ])
  const calls = ['a.ts', 'b.ts'].map(path => ({ occurrence: occurrence(`call:${path}`), typeArguments: [], arguments: [], bindings: [], callbacks: [], dynamic: true }))
  const logical: FunctionBodyIR = { ...body(nodes), calls,
    relations: ['a.ts', 'b.ts'].map(path => ({ parent: occurrence(`call:${path}`), child: occurrence(`callee:${path}`), role: 'callee' })),
    summary: { ...body(nodes).summary, calls: calls.map(call => call.occurrence) },
  }
  const bodyFact = fact('body', owner, { body: logical, values: {}, completeness: { kind: 'complete' } })
  expect(validateTypeScriptFactPayload('body', bodyFact.payload)).toEqual([])
  const facts: IndexedFact[] = [bodyFact, ...['a.ts', 'b.ts'].map(path => fact('source', source(path), {
    source: source(path), revision: span(path).revision, logicalPath: path, textDigest: path, declaration: false, projectOwned: true,
  }))]
  const index = IndexedValues.empty().update(facts, [], true)
  const reader = createValueEvaluatorFactory(query(facts), undefined, async () => index)
  expect((await reader.calls()).sites.map(site => site.path).sort()).toEqual(['a.ts', 'b.ts'])
  for (const path of ['a.ts', 'b.ts']) {
    const selected = await reader.calls({ paths: [path] })
    expect(selected.completeness).toEqual({ kind: 'complete' })
    expect(selected.sites.map(site => site.call.occurrence)).toEqual([occurrence(`call:${path}`)])
    expect((await reader.calls({ sources: [source(path)] })).sites).toEqual(selected.sites)
  }
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deriveAnalysisId, type SymbolId } from '../analysis/identity/index.ts'
import { BodyDemandExpansionRequired, openTypeScriptProject, createTypeScriptFactReader, type BoundedValueLimits, type SymbolicCallModel, type TypeScriptFunctionHeader, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { validateTypeScriptFactPayload } from '../analysis/typescript/facts/validate.ts'
import { createValueEvaluatorFactory } from '../analysis/typescript/value/symbolic/engine.ts'
import { IndexedValues, loadValueIndex, type IndexedFact } from '../analysis/typescript/value/symbolic/facts.ts'

type Demand = TypeScriptFact<'body-demand'>
let root: string, full: TypeScriptProject, demand: TypeScriptProject
let oracle: TypeScriptProjectSnapshot, selected: TypeScriptProjectSnapshot
let fullIndex: IndexedValues, baseIndex: IndexedValues, original: Demand, certificate: Demand
let originalFacts: IndexedFact[]
const certificateIds = new Set<Demand['id']>()

// The independently compiled full snapshot is the header producer oracle. The
// current producer may publish headers, so the compatibility fixture explicitly
// projects them out before exercising the additive wire contract. Native producer
// behavior is independently covered by typescript-function-header-native.test.ts.
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'codegraph-function-header-'))
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] })),
    writeFile(join(root, 'selected.ts'), `import { helper, asynchronous, generator, asyncGenerator, unusual, capture, lambda, changed, escaped, shared, orderedParameters } from './library'
declare function marker(value: unknown): unknown
export const imported = helper
export const asyncImported = asynchronous
export const generatorImported = generator
export const asyncGeneratorImported = asyncGenerator
export const unusualImported = unusual
export const orderedParametersImported = orderedParameters
export const lambdaImported = lambda
export const modeled = marker(helper)
export const closure = capture('closed')
export const receiver = { method: helper }
export const mutation = changed
export const escape = escaped
declare const flag: boolean
export const branch = flag ? helper : asynchronous
export const ordered = shared
`),
    writeFile(join(root, 'library.ts'), `declare function unknownEffect(value: unknown): void
export function helper(value: unknown = 'fallback') { return value }
export async function asynchronous(value: unknown) { return value }
export function* generator(value: unknown) { return value }
export async function* asyncGenerator(value: unknown) { return value }
export function unusual({ field }: { field: unknown }, ...rest: unknown[]) { return field }
export function orderedParameters(first: unknown, second: unknown) { return first }
export function capture(value: unknown) { return () => value }
export const lambda = (value: unknown) => value
export let changed = () => 'original'
changed = () => 'changed'
export const escaped = () => 'escaped'
unknownEffect(escaped)
export const shared = { value: 'stable' }
`),
    ...[0, 1].map(number => writeFile(join(root, `alias-${number}.ts`), `import { shared } from './library'; export function alias${number}() { const copy = shared; return copy }`)),
  ])
  const options = { root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) }
  full = await openTypeScriptProject({ ...options, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'] })
  demand = await openTypeScriptProject({ ...options, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body-demand'] })
  await full.refresh(); await demand.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [] } })
  oracle = await full.open(); selected = await demand.open()
  fullIndex = await loadValueIndex(oracle.query); baseIndex = await loadValueIndex(selected.query)
  originalFacts = []
  const reader = createTypeScriptFactReader(selected.query)
  for (const kind of ['body', 'symbol', 'source', 'body-demand'] as const) for await (const fact of reader.export(kind)) originalFacts.push(fact as IndexedFact)
  original = originalFacts.find((fact): fact is Demand => fact.namespace === 'typescript.body-demand')!
  const nativeOriginal = original
  original = revise({ ...nativeOriginal.payload, owners: nativeOriginal.payload.owners.map(({ header: _header, ...owner }) => owner) })
  baseIndex = baseIndex.update([original], [nativeOriginal.id])
  expect(baseIndex.headers.size).toBe(0)
  const owners = original.payload.owners.map((owner) => {
    const body = fullIndex.bodies.get(owner.owner)?.payload.body
    if (owner.scope !== 'function' || !body?.execution) return owner
    const header: TypeScriptFunctionHeader = { owner: owner.owner, span: owner.span, parameters: [...body.parameters], execution: body.execution }
    return { ...owner, header }
  })
  certificate = revise({ ...original.payload, owners })
  expect(validateTypeScriptFactPayload('body-demand', certificate.payload)).toEqual([])
}, 60_000)
afterAll(async () => {
  await oracle?.dispose(); await selected?.dispose()
  await full?.dispose(); await demand?.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})
function revise(payload: Demand['payload']): Demand {
  const id = deriveAnalysisId('fact', 'function-header-test', payload)
  certificateIds.add(id)
  return { ...original, id, payload }
}
function index(cert = certificate) { return baseIndex.update([cert], [original.id]) }
function symbol(name: string): SymbolId {
  return [...fullIndex.symbols.values()].find((fact) => fact.payload.name === name)!.payload.symbol
}
function initializer(name: string) { return fullIndex.initializers.get(symbol(name))![0]! }
async function evaluator(current = index(), model?: SymbolicCallModel<never>) {
  return createValueEvaluatorFactory(selected.query, undefined, async () => current)({ call: model })
}
function result(proof: { evidence: unknown }) { const { evidence: _evidence, ...value } = proof; return value }
async function expansion(operation: Promise<unknown>) {
  try { await operation; throw new Error('Expected owned body expansion') }
  catch (error) {
    expect(error).toBeInstanceOf(BodyDemandExpansionRequired)
    return (error as BodyDemandExpansionRequired).receipt
  }
}
async function materialize(current: IndexedValues, operation: (value: Awaited<ReturnType<typeof evaluator>>) => Promise<unknown>) {
  for (let wave = 0; wave < 12; wave++) {
    try { return { proof: await operation(await evaluator(current)), current } }
    catch (error) {
      if (!(error instanceof BodyDemandExpansionRequired)) throw error
      const bodies = error.receipt.requirements.map(({ owner }) => fullIndex.bodies.get(owner)!)
      expect(bodies.every(Boolean)).toBe(true)
      const materialized = new Map([...current.bodies, ...bodies.map(body => [body.payload.body.function, body] as const)])
      const cert = revise({ ...certificate.payload, owners: certificate.payload.owners.map(member => {
        const body = materialized.get(member.owner)
        return body ? { ...member, materialized: true, fact: body.id } : member
      }) })
      current = current.update([...bodies, cert], [original.id, ...certificateIds].filter(id => id !== cert.id))
    }
  }
  throw new Error('Fixture body expansion made no progress')
}

describe('certified function headers independent of full body rows', () => {
  it.each(['imported', 'asyncImported', 'generatorImported', 'asyncGeneratorImported', 'unusualImported', 'orderedParametersImported'])('resolves %s shape exactly as the independent full-body reader', async (name) => {
    const current = index(), occurrence = initializer(name)
    const value = await evaluator(current), reference = await oracle.values()
    const actual = await value.value(occurrence).resolve(), expected = await reference.value(occurrence).resolve()
    expect(result(actual)).toEqual(result(expected))
    expect(actual.kind).toBe('known')
    const owner = (actual as Extract<typeof actual, { kind: 'known' }>).value
    expect(owner.kind).toBe('function')
    if (owner.kind !== 'function') throw new Error('Expected function shape')
    expect(current.bodies.has(owner.symbol)).toBe(false)
    expect(current.headers.get(owner.symbol)?.parameters.length).toBe(owner.parameterCount)
    expect(actual.evidence).toContain(certificate.id)
  })

  it('requires the actual body before invoking even an async header, and retains property/scalar behavior', async () => {
    const value = await evaluator(), reference = await oracle.values()
    for (const name of ['imported', 'asyncImported', 'generatorImported', 'asyncGeneratorImported']) {
      const occurrence = initializer(name), receipt = await expansion(value.value(occurrence).invoke().resolve())
      expect(receipt.generation).toBe(selected.generation.id)
      expect(receipt.sourceManifest).toBe(selected.generation.sourceManifest)
      expect(receipt.requirements).toContainEqual({ owner: symbol(name === 'imported' ? 'helper' : name === 'asyncImported' ? 'asynchronous' : name === 'generatorImported' ? 'generator' : 'asyncGenerator'), kind: 'body' })
      const actual = await materialize(index(), (consumer) => consumer.value(occurrence).invoke().resolve())
      expect(result(actual.proof as { evidence: unknown })).toEqual(result(await reference.value(occurrence).invoke().resolve()))
      expect(result(await value.value(occurrence).property('length').resolve())).toEqual(result(await reference.value(occurrence).property('length').resolve()))
      expect(result(await value.evaluate(occurrence))).toEqual(result(await reference.evaluate(occurrence)))
    }
  })

  it('uses only an exact original function witness; arbitrary witnesses continue to require their original body', async () => {
    const current = index(), owner = fullIndex.occurrences.get(initializer('lambda'))!.symbol!
    const member = certificate.payload.owners.find((member) => member.owner === owner)!
    const node = [...fullIndex.occurrences.values()].find((node) => node.syntax === 'ArrowFunction' && node.symbol === owner)!
    const witness = { id: node.id, owner: node.owner, kind: node.kind, syntax: node.syntax, symbol: node.symbol, span: node.span }
    expect(witness.span).toEqual(member.header!.span)
    const cert = revise({ ...certificate.payload, witnesses: [...certificate.payload.witnesses.filter((item) => item.id !== witness.id), witness] })
    expect(validateTypeScriptFactPayload('body-demand', cert.payload)).toEqual([])
    const value = await evaluator(baseIndex.update([cert], [original.id]))
    expect(result(await value.value(node.id).resolve())).toEqual(result(await (await oracle.values()).value(node.id).resolve()))
    expect(current.bodies.has(node.owner)).toBe(false)
    for (const change of [{ symbol: symbol('helper') }, { syntax: 'Identifier' }, { span: { ...node.span, end: node.span.end - 1 } }]) {
      const altered = revise({ ...cert.payload, witnesses: cert.payload.witnesses.map((item) => item.id === witness.id ? { ...item, ...change } : item) })
      const receipt = await expansion((await evaluator(baseIndex.update([altered], [original.id]))).value(node.id).resolve())
      expect(receipt.requirements).toContainEqual({ owner: node.owner, kind: 'body' })
    }
  })

  it('preserves returned closure environments and receiver plans through staged body expansion', async () => {
    const occurrence = initializer('closure'), reference = await oracle.values()
    const shape = await materialize(index(), (value) => value.value(occurrence).resolve())
    expect(result(shape.proof as { evidence: unknown })).toEqual(result(await reference.value(occurrence).resolve()))
    const target = (shape.proof as { value: { symbol: SymbolId } }).value.symbol
    expect(shape.current.headers.has(target)).toBe(true)
    expect(shape.current.bodies.has(target)).toBe(false)
    const body = await materialize(shape.current, (value) => value.value(occurrence).invoke().resolve())
    expect(result(body.proof as { evidence: unknown })).toEqual(result(await reference.value(occurrence).invoke().resolve()))
    expect(body.proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'closed' } })
    const receiver = initializer('receiver'), consumer = await evaluator()
    expect(result(await consumer.value(receiver).property('method').resolve())).toEqual(result(await reference.value(receiver).property('method').resolve()))
    await expansion(consumer.value(receiver).property('method').invoke().resolve())
  })

  it('consults call models before body reads and cannot swallow an actual invocation receipt', async () => {
    const occurrence = initializer('modeled')
    const keepShape: SymbolicCallModel<never> = context => context.argument(0)
    const value = await evaluator(index(), keepShape), reference = await oracle.values({ call: keepShape })
    expect(result(await value.value(occurrence).resolve())).toEqual(result(await reference.value(occurrence).resolve()))
    const swallow: SymbolicCallModel<string> = context => {
      try { context.argument(0)?.invoke().resolve() } catch (error) { expect(error).toBeInstanceOf(BodyDemandExpansionRequired) }
      return { kind: 'atom', value: 'swallowed' }
    }
    const consumer = await createValueEvaluatorFactory(selected.query, undefined, async () => index())({ call: swallow })
    await expansion(consumer.value(occurrence).resolve())
    await expansion(consumer.value(occurrence).resolve())
  })

  it.each([1, 3, 12, 32])('retains exact step/depth/alternative budgets at %i steps', async maximumSteps => {
    const limits: BoundedValueLimits = { maximumSteps, maximumDepth: 12, maximumAlternatives: 3 }
    const value = await evaluator(), reference = await oracle.values()
    for (const name of ['imported', 'receiver']) {
      expect(result(await value.value(initializer(name)).resolve({ limits }))).toEqual(result(await reference.value(initializer(name)).resolve({ limits })))
    }
  })

  it('requires original effect ordering IDs even when contributor function headers are complete', async () => {
    const occurrence = initializer('ordered'), current = index()
    const receipt = await expansion((await evaluator(current)).value(occurrence).resolve())
    const ordered = receipt.requirements.filter(requirement => requirement.kind === 'effect-order')
    expect(ordered).toHaveLength(2)
    for (const { owner } of ordered) { expect(current.headers.has(owner)).toBe(true); expect(current.bodies.has(owner)).toBe(false) }
    const actual = await materialize(current, value => value.value(occurrence).resolve())
    expect(result(actual.proof as { evidence: unknown })).toEqual(result(await (await oracle.values()).value(occurrence).resolve()))
  })

  it.each([{ maximumDepth: 1 }, { maximumDepth: 2 }, { maximumAlternatives: 1 }, { maximumAlternatives: 2 }])('retains independent depth and alternative limits %j', async limits => {
    const value = await evaluator(), reference = await oracle.values()
    for (const name of ['branch', 'receiver']) {
      expect(result(await value.value(initializer(name)).resolve({ limits }))).toEqual(result(await reference.value(initializer(name)).resolve({ limits })))
    }
  })

  it('preserves global mutation and escape authority before publishing any header shape', async () => {
    const value = await evaluator(), reference = await oracle.values()
    for (const name of ['mutation', 'escape']) {
      const actual = await materialize(index(), (consumer) => consumer.value(initializer(name)).resolve())
      expect(result(actual.proof as { evidence: unknown })).toEqual(result(await reference.value(initializer(name)).resolve()))
    }
    expect(value).toBeDefined()
  })

  it('keeps old pins and invalidates both positive and absent header reads on replacement/retirement', async () => {
    const current = index(), old = await evaluator(current), occurrence = initializer('imported')
    const proof = await old.value(occurrence).resolve()
    const changed = revise({ ...certificate.payload, owners: certificate.payload.owners.map(member => member.owner === symbol('helper') ? { ...member, header: { ...member.header!, parameters: [] } } : member) })
    const updated = current.update([changed], [certificate.id]), fresh = await evaluator(updated)
    expect(updated.revision.changed.has(`header:${symbol('helper')}`)).toBe(true)
    expect(fresh.canReuse(proof)).toBe(false)
    expect(await fresh.value(occurrence).resolve()).toMatchObject({ kind: 'known', value: { kind: 'function', parameterCount: 0 } })
    expect(await old.value(occurrence).resolve()).toEqual(proof)
    const retired = current.update([original], [certificate.id])
    await expansion((await evaluator(retired)).value(occurrence).resolve())
    const fullWithNoHeader = baseIndex.update([...fullIndex.bodies.values()], [])
    const noHeader = await evaluator(fullWithNoHeader), absent = await noHeader.value(occurrence).resolve()
    const added = fullWithNoHeader.update([certificate], [original.id])
    expect(added.revision.changed.has(`header:${symbol('helper')}`)).toBe(true)
    expect((await evaluator(added)).canReuse(absent)).toBe(false)
  })

  it('owns external header descendants and rejects disagreement with original full body metadata/span', async () => {
    const external = structuredClone(certificate), current = baseIndex.update([external], [original.id])
    const header = external.payload.owners.find(member => member.owner === symbol('helper'))!.header!
    ;(header.parameters as SymbolId[]).length = 0
    expect(current.headers.get(symbol('helper'))!.parameters.length).toBe(1)
    expect(Object.isFrozen(current.headers.get(symbol('helper'))!.parameters)).toBe(true)
    expect(() => current.update([fullIndex.bodies.get(symbol('helper'))!], [])).not.toThrow()
    const changed = revise({ ...certificate.payload, owners: certificate.payload.owners.map(member => member.owner === symbol('helper') ? { ...member, header: { ...member.header!, execution: 'async' as const } } : member) })
    expect(() => index(changed).update([fullIndex.bodies.get(symbol('helper'))!], [])).toThrow('header-body-mismatch')
    const wrongSpan = { ...fullIndex.bodies.get(symbol('helper'))!, provenance: { ...fullIndex.bodies.get(symbol('helper'))!.provenance, evidence: [] } }
    expect(() => current.update([wrongSpan], [])).toThrow('header-body-mismatch')
  })

  it('rejects current-source and ordered-parameter disagreement without corrupting an old reader', async () => {
    const current = index(), before = await evaluator(current), proof = await before.value(initializer('orderedParametersImported')).resolve()
    const parameterOwner = symbol('orderedParameters'), fullBody = fullIndex.bodies.get(parameterOwner)!
    expect(fullBody.payload.body.parameters.length).toBeGreaterThan(1)
    const reordered = revise({ ...certificate.payload, owners: certificate.payload.owners.map(member => member.owner === parameterOwner ?
      { ...member, header: { ...member.header!, parameters: [...member.header!.parameters].reverse() } } : member) })
    expect(() => index(reordered).update([fullBody], [])).toThrow('header-body-mismatch')
    const helper = certificate.payload.owners.find(member => member.owner === symbol('helper'))!
    const source = current.sources.get(helper.span.source)!
    const revision = deriveAnalysisId('source-revision', 'function-header-test', 'edited-library')
    expect(() => current.update([{ ...source, payload: { ...source.payload, revision } }], [])).toThrow('header-source-mismatch')
    expect(await before.value(initializer('orderedParametersImported')).resolve()).toEqual(proof)
  })

  it('keeps absent execution metadata on legacy full bodies conservative', async () => {
    const originalBody = fullIndex.bodies.get(symbol('helper'))!
    const body = { ...originalBody, payload: { ...originalBody.payload, body: { ...originalBody.payload.body, execution: undefined } } }
    expect(validateTypeScriptFactPayload('body', body.payload)).toEqual([])
    const current = baseIndex.update([body], []), value = await evaluator(current)
    expect(await value.value(initializer('imported')).resolve()).toMatchObject({ kind: 'known', value: { kind: 'function', execution: undefined } })
    expect(await value.value(initializer('imported')).invoke().resolve()).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_EXECUTION_UNSUPPORTED' })] })
  })

  it('retains legacy absent-header behavior and mixed full/header equality', async () => {
    await expansion((await evaluator(baseIndex)).value(initializer('imported')).resolve())
    const body = fullIndex.bodies.get(symbol('helper'))!
    const mixed = index().update([body], [])
    expect(result(await (await evaluator(mixed)).value(initializer('imported')).resolve())).toEqual(result(await (await oracle.values()).value(initializer('imported')).resolve()))
    expect(result(await (await evaluator(mixed)).value(initializer('imported')).invoke().resolve())).toEqual(result(await (await oracle.values()).value(initializer('imported')).invoke().resolve()))
  })
})

describe('function header admission', () => {
  it.each([
    ['module scope', (owner: Demand['payload']['owners'][number]) => ({ ...owner, scope: 'module' as const }), 'owners:header-scope'],
    ['owner identity', (owner: Demand['payload']['owners'][number]) => ({ ...owner, header: { ...owner.header!, owner: symbol('capture') } }), 'owners:header-owner-span'],
    ['source revision', (owner: Demand['payload']['owners'][number]) => ({ ...owner, header: { ...owner.header!, span: { ...owner.span, revision: deriveAnalysisId('source-revision', 'header', 'wrong') } } }), 'owners:header-owner-span'],
    ['duplicate parameters', (owner: Demand['payload']['owners'][number]) => ({ ...owner, header: { ...owner.header!, parameters: [symbol('helper'), symbol('helper')] } }), 'owners:header-invalid'],
    ['unknown execution', (owner: Demand['payload']['owners'][number]) => ({ ...owner, header: { ...owner.header!, execution: 'unknown' } }), 'owners:header-invalid'],
  ] as const)('rejects malformed %s at typed admission', async (_name, change, diagnostic) => {
    const payload = { ...certificate.payload, owners: certificate.payload.owners.map(member => member.owner === symbol('helper') ? change(member) : member) }
    expect(validateTypeScriptFactPayload('body-demand', payload)).toContain(diagnostic)
    const forged = { ...revise(certificate.payload), payload }
    const query = { ...selected.query, async *export() { yield forged } }
    await expect(createTypeScriptFactReader(query).export('body-demand')[Symbol.asyncIterator]().next()).rejects.toMatchObject({ diagnostics: expect.arrayContaining([diagnostic]) })
  })
  it('rejects an incomplete certificate instead of guessing header completeness', () => {
    expect(validateTypeScriptFactPayload('body-demand', { ...certificate.payload, completeness: { kind: 'partial', reasons: [] } })).toContain('owners:header-incomplete-certificate')
  })
})

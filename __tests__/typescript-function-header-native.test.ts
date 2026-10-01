import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BodyDemandExpansionRequired, createTypeScriptFactReader, openTypeScriptProject, type BoundedValueLimits, type SymbolicCallModel, type TypeScriptBodyDemandReceipt, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { OccurrenceId, SymbolId } from '../analysis/identity/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { loadValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'

type Demand = TypeScriptFact<'body-demand'>
const roots: string[] = [], projects: TypeScriptProject[] = [], snapshots: TypeScriptProjectSnapshot[] = []
let root: string, full: TypeScriptProject, demand: TypeScriptProject
let oracle: TypeScriptProjectSnapshot, selected: TypeScriptProjectSnapshot, certificate: Demand
const library = `
export function helper(input: unknown) { return 'stable' }
export async function asynchronous(input: unknown) { return input }
export function* generator(input: unknown) { return input }
export async function* asyncGenerator(input: unknown) { return input }
export function destructured({ field }: { field: unknown }, ...rest: unknown[]) { return field }
export function ordered(first: unknown, second: unknown) { return first }
export function capture(input: unknown) { return () => input }
export const lambda = (input: unknown) => input
export const unusedProject = () => 'unused-project'
export class Holder {
  field = () => 'captured-field'
  method(input: unknown) { return input }
  get value() { return 'value' }
}
`
// This suite admits ORIGINAL native certificates. It never replaces a header,
// witness, fact ID or body row using the oracle. Qualification must select the
// exact H17 binary via CODEGRAPH_TEST_NATIVE_BINARY; old package pins stay intact.
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'codegraph-native-function-header-')); roots.push(root)
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] })),
    writeFile(join(root, 'selected.ts'), `import { helper, asynchronous, generator, asyncGenerator, destructured, ordered, capture, lambda, unusedProject } from './library'
declare function marker(input: unknown): unknown
declare const flag: boolean
export const imported = helper
export const asyncImported = asynchronous
export const generatorImported = generator
export const asyncGeneratorImported = asyncGenerator
export const destructuredImported = destructured
export const orderedImported = ordered
export const lambdaImported = lambda
export const invocation = helper('input')
export const closure = capture('closed')
export const receiver = { method: helper, project: unusedProject }
export const conditional = flag ? helper : asynchronous
export const modeled = marker(unusedProject)
`),
    writeFile(join(root, 'library.ts'), library),
  ])
  const options = { root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) }
  full = await openTypeScriptProject({ ...options, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'] })
  demand = await openTypeScriptProject({ ...options, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body-demand'] })
  projects.push(full, demand)
  await full.refresh(); await demand.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [] } })
  oracle = await pin(full); selected = await pin(demand)
  certificate = await nativeCertificate(selected)
}, 60_000)
afterAll(async () => {
  await Promise.all(snapshots.splice(0).map(snapshot => snapshot.dispose()))
  await Promise.all(projects.splice(0).map(project => project.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function pin(project: TypeScriptProject) {
  const snapshot = await project.open(); snapshots.push(snapshot); return snapshot
}
async function nativeCertificate(snapshot: TypeScriptProjectSnapshot) {
  const facts: Demand[] = []
  for await (const fact of createTypeScriptFactReader(snapshot.query).export('body-demand')) facts.push(fact)
  expect(facts).toHaveLength(1)
  return facts[0]!
}
async function initializer(snapshot: TypeScriptProjectSnapshot, name: string): Promise<OccurrenceId> {
  const index = await loadValueIndex(snapshot.query)
  const symbol = [...index.symbols.values()].find(fact => fact.payload.name === name)!.payload.symbol
  return index.initializers.get(symbol)![0]!
}
async function namedOwner(snapshot: TypeScriptProjectSnapshot, name: string): Promise<SymbolId> {
  const index = await loadValueIndex(snapshot.query)
  return [...index.symbols.values()].find(fact => fact.payload.name === name)!.payload.symbol
}
function result(proof: { readonly evidence: unknown }) { const { evidence: _evidence, ...value } = proof; return value }
async function expansion(operation: Promise<unknown>, snapshot: TypeScriptProjectSnapshot) {
  try { await operation; throw new Error('Expected native-owned body demand') }
  catch (error) {
    expect(error).toBeInstanceOf(BodyDemandExpansionRequired)
    const receipt = (error as BodyDemandExpansionRequired).receipt
    expect(receipt.generation).toBe(snapshot.generation.id)
    expect(receipt.sourceManifest).toBe(snapshot.generation.sourceManifest)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.requirements)).toBe(true)
    expect(receipt.requirements.every(requirement => Object.isFrozen(requirement))).toBe(true)
    return receipt
  }
}
async function replay(name: string, invoke = false) {
  const owners = new Set<SymbolId>(), receipts: TypeScriptBodyDemandReceipt[] = []
  await demand.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [] } })
  for (let wave = 0; wave < 12; wave++) {
    const snapshot = await pin(demand), value = await snapshot.values(), occurrence = await initializer(snapshot, name)
    try {
      const plan = value.value(occurrence)
      const proof = await (invoke ? plan.invoke() : plan).resolve()
      return { proof, owners, receipts, snapshot }
    } catch (error) {
      if (!(error instanceof BodyDemandExpansionRequired)) throw error
      expect(error.receipt.generation).toBe(snapshot.generation.id)
      expect(error.receipt.sourceManifest).toBe(snapshot.generation.sourceManifest)
      const before = owners.size
      for (const { owner } of error.receipt.requirements) owners.add(owner)
      expect(owners.size).toBeGreaterThan(before)
      receipts.push(error.receipt)
    }
    await demand.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [...owners] } })
  }
  throw new Error('Native H17 header replay made no progress')
}

describe('original native H17 function header authority', () => {
  it('emits exact original callable metadata, including class methods/fields and ordered parameter identities', async () => {
    const original = await nativeCertificate(selected), reference = await loadValueIndex(oracle.query)
    expect(original).toEqual(certificate)
    expect(original.payload.observed).toBe(true)
    expect(original.payload.completeness).toEqual({ kind: 'complete' })
    const owners = original.payload.owners.filter(owner => owner.scope === 'function')
    expect(owners.length).toBeGreaterThan(10)
    for (const owner of owners) {
      const body = reference.bodies.get(owner.owner)!
      expect(body).toBeDefined()
      expect(owner.header).toEqual({ owner: owner.owner, span: owner.span,
        parameters: body.payload.body.parameters, execution: body.payload.body.execution })
      expect(Object.isFrozen(owner.header!.parameters)).toBe(true)
      expect(Object.isFrozen(owner.header!.span)).toBe(true)
      expect(new Set(owner.header!.parameters).size).toBe(owner.header!.parameters.length)
      expect(body.provenance.evidence).toContainEqual(owner.header!.span)
      expect(original.payload.owners.filter(member => member.owner === owner.owner)).toHaveLength(1)
      if (!owner.materialized) expect(owner).not.toHaveProperty('fact')
    }
    for (const owner of original.payload.owners.filter(owner => owner.scope === 'module')) expect(owner).not.toHaveProperty('header')
    const index = await loadValueIndex(selected.query)
    const libSource = [...index.sources.values()].find(fact => fact.payload.logicalPath === 'library.ts')!
    for (const owner of owners.filter(owner => owner.path === 'library.ts')) expect(owner.header!.span.revision).toBe(libSource.payload.revision)
  })

  it.each(['imported', 'asyncImported', 'generatorImported', 'asyncGeneratorImported', 'destructuredImported', 'orderedImported', 'lambdaImported'])('resolves %s from original native headers with its implementation omitted', async name => {
    const occurrence = await initializer(selected, name), value = await selected.values(), reference = await oracle.values()
    const proof = await value.value(occurrence).resolve()
    expect(result(proof)).toEqual(result(await reference.value(await initializer(oracle, name)).resolve()))
    expect(proof.kind).toBe('known')
    if (proof.kind !== 'known' || proof.value.kind !== 'function') throw new Error('Expected original native function header')
    const owner = proof.value.symbol
    const index = await loadValueIndex(selected.query), member = certificate.payload.owners.find(member => member.owner === owner)!
    expect(member.materialized).toBe(false)
    expect(member.header).toBeDefined()
    expect(index.bodies.has(proof.value.symbol)).toBe(false)
    expect(proof.evidence).toContain(certificate.id)
    expect(await nativeCertificate(selected)).toEqual(certificate)
  })

  it('does not turn header completeness into full body or call coverage', async () => {
    expect(certificate.payload.owners.some(owner => owner.path === 'library.ts' && owner.header && !owner.materialized)).toBe(true)
    expect((await selected.calls({ paths: ['selected.ts'] })).completeness).toEqual({ kind: 'complete' })
    expect((await selected.calls({ paths: ['library.ts'] })).completeness.kind).toBe('partial')
    expect((await selected.calls()).completeness.kind).toBe('partial')
  })

  it('requires actual original body ownership at invocation and preserves pins through native recipe expansion', async () => {
    const before = await selected.values(), occurrence = await initializer(selected, 'imported')
    const shape = await before.value(occurrence).resolve()
    const missing = await expansion(before.value(occurrence).invoke().resolve(), selected)
    expect(missing.requirements).toContainEqual({ owner: await namedOwner(oracle, 'helper'), kind: 'body' })
    const actual = await replay('imported', true), reference = await oracle.values()
    expect(actual.receipts.length).toBeGreaterThan(0)
    expect(result(actual.proof)).toEqual(result(await reference.value(await initializer(oracle, 'imported')).invoke().resolve()))
    const bodyIndex = await loadValueIndex(actual.snapshot.query)
    expect(bodyIndex.bodies.get(await namedOwner(oracle, 'helper'))!.id).toBe((await loadValueIndex(oracle.query)).bodies.get(await namedOwner(oracle, 'helper'))!.id)
    expect(await before.value(occurrence).resolve()).toEqual(shape)
    expect(await expansion(before.value(occurrence).invoke().resolve(), selected)).toEqual(missing)
    expect((await loadValueIndex(selected.query)).bodies.has(await namedOwner(oracle, 'helper'))).toBe(false)
  })

  it('keeps async/generator invocation conservative after obtaining true bodies', async () => {
    const reference = await oracle.values()
    for (const name of ['asyncImported', 'generatorImported', 'asyncGeneratorImported']) {
      const actual = await replay(name, true)
      expect(actual.receipts.some(receipt => receipt.requirements.some(requirement => requirement.kind === 'body'))).toBe(true)
      expect(result(actual.proof)).toEqual(result(await reference.value(await initializer(oracle, name)).invoke().resolve()))
      expect(actual.proof).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_EXECUTION_UNSUPPORTED' })] })
    }
  })

  it('preserves captured closures and leaves the unrelated project implementation omitted', async () => {
    const actual = await replay('closure', true), reference = await oracle.values()
    expect(result(actual.proof)).toEqual(result(await reference.value(await initializer(oracle, 'closure')).invoke().resolve()))
    expect(actual.proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'closed' } })
    const current = await loadValueIndex(actual.snapshot.query)
    const project = (await loadValueIndex(oracle.query)).occurrences.get(await initializer(oracle, 'unusedProject'))!.symbol!
    expect(current.headers.has(project)).toBe(true)
    expect(current.bodies.has(project)).toBe(false)
    expect(actual.owners.has(project)).toBe(false)
  })

  it('preserves call models, receiver property shape and unsupported function properties without demanding bodies', async () => {
    const model: SymbolicCallModel<never> = context => context.argument(0)
    const value = await selected.values({ call: model }), reference = await oracle.values({ call: model })
    expect(result(await value.value(await initializer(selected, 'modeled')).resolve())).toEqual(result(await reference.value(await initializer(oracle, 'modeled')).resolve()))
    const receiver = await initializer(selected, 'receiver'), oracleReceiver = await initializer(oracle, 'receiver')
    expect(result(await value.value(receiver).property('project').resolve())).toEqual(result(await reference.value(oracleReceiver).property('project').resolve()))
    expect(result(await value.value(receiver).property('method').property('length').resolve())).toEqual(result(await reference.value(oracleReceiver).property('method').property('length').resolve()))
    await expansion(value.value(receiver).property('method').invoke().resolve(), selected)
  })

  it.each([3, 12, 32])('retains full-oracle effective budgets at %i steps and separate depth/alternative bounds', async maximumSteps => {
    const limits: BoundedValueLimits = { maximumSteps, maximumDepth: 12, maximumAlternatives: 2 }
    const value = await selected.values(), reference = await oracle.values()
    for (const name of ['imported', 'receiver', 'conditional']) {
      expect(result(await value.value(await initializer(selected, name)).resolve({ limits }))).toEqual(result(await reference.value(await initializer(oracle, name)).resolve({ limits })))
    }
    for (const extra of [{ maximumDepth: 1 }, { maximumAlternatives: 1 }]) {
      expect(result(await value.value(await initializer(selected, 'conditional')).resolve({ limits: { ...limits, ...extra } }))).toEqual(result(await reference.value(await initializer(oracle, 'conditional')).resolve({ limits: { ...limits, ...extra } })))
    }
  })

  it('captures changed dependency header metadata and body values under current receipts while prior pins stay immutable', async () => {
    const oldValue = await selected.values(), oldOccurrence = await initializer(selected, 'imported')
    const oldShape = await oldValue.value(oldOccurrence).resolve()
    const oldReceipt = await expansion(oldValue.value(oldOccurrence).invoke().resolve(), selected)
    const edited = library.replace("function helper(input: unknown) { return 'stable' }", "function helper(input: unknown, other: unknown) { return 'edited' }")
    try {
      await writeFile(join(root, 'library.ts'), edited)
      await full.refresh({ changed: ['library.ts'] })
      await demand.refresh({ changed: ['library.ts'], bodyDemand: { paths: ['selected.ts'], owners: [] } })
      const current = await pin(demand), fresh = await pin(full), currentValue = await current.values(), freshValue = await fresh.values()
      const occurrence = await initializer(current, 'imported'), proof = await currentValue.value(occurrence).resolve()
      expect(result(proof)).toEqual(result(await freshValue.value(await initializer(fresh, 'imported')).resolve()))
      expect(proof).toMatchObject({ kind: 'known', value: { kind: 'function', parameterCount: 2 } })
      expect(currentValue.canReuse(oldShape)).toBe(false)
      const receipt = await expansion(currentValue.value(occurrence).invoke().resolve(), current)
      expect(receipt.sourceManifest).not.toBe(oldReceipt.sourceManifest)
      const actual = await replay('imported', true)
      expect(result(actual.proof)).toEqual(result(await freshValue.value(await initializer(fresh, 'imported')).invoke().resolve()))
      expect(actual.proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'edited' } })
      expect(await oldValue.value(oldOccurrence).resolve()).toEqual(oldShape)
      expect(await expansion(oldValue.value(oldOccurrence).invoke().resolve(), selected)).toEqual(oldReceipt)
      expect(await nativeCertificate(selected)).toEqual(certificate)
    } finally {
      await writeFile(join(root, 'library.ts'), library)
      await full.refresh({ changed: ['library.ts'] })
      await demand.refresh({ changed: ['library.ts'], bodyDemand: { paths: ['selected.ts'], owners: [] } })
    }
  })
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BodyDemandExpansionRequired, openTypeScriptProject, type SymbolicCallModel,
  type TypeScriptProject, type TypeScriptProjectSnapshot, type TypeScriptSemanticReader,
} from '../analysis/typescript/index.ts'
import { loadValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'
import type { FactId, OccurrenceId, SymbolId } from '../analysis/identity/index.ts'

const roots: string[] = [], projects: TypeScriptProject[] = [], snapshots: TypeScriptProjectSnapshot[] = []
afterEach(async () => {
  await Promise.all(snapshots.splice(0).map(snapshot => snapshot.dispose()))
  await Promise.all(projects.splice(0).map(project => project.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-demand-evidence-')); roots.push(root)
  const library = join(root, 'node_modules/@fixture/definitions')
  await mkdir(library, { recursive: true })
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] })),
    writeFile(join(library, 'package.json'), JSON.stringify({ name: '@fixture/definitions', types: 'index.d.ts' })),
    writeFile(join(library, 'index.d.ts'), 'export declare function define(value: unknown): unknown\n'),
    writeFile(join(root, 'selected.ts'), "import { define } from '@fixture/definitions'; import { helper, untouched } from './library'; export const definition = define({ id: helper() }); export const shape = untouched;\n"),
    writeFile(join(root, 'library.ts'), "export function helper() { return 'first' }; export function untouched(input: unknown) { return input };\n"),
    writeFile(join(root, 'unrelated.ts'), "export const unrelated = 'first'\n"),
  ])
  const project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body-demand'],
  })
  projects.push(project)
  const owners = new Set<SymbolId>()
  const refresh = (changed?: string[]) => project.refresh({ ...(changed ? { changed } : {}), bodyDemand: { paths: ['selected.ts'], owners: [...owners] } })
  await refresh()
  const open = async () => { const snapshot = await project.open(); snapshots.push(snapshot); return snapshot }
  return { root, owners, refresh, open }
}

async function coordinates(snapshot: TypeScriptProjectSnapshot) {
  const index = await loadValueIndex(snapshot.query)
  const initializer = (name: string) => index.initializers.get([...index.symbols.values()].find(fact => fact.payload.name === name)!.payload.symbol)![0]!
  const definition = initializer('definition')
  return { definition, callee: index.children.get(definition)!.get('callee')!, shape: initializer('shape') }
}

async function owned(snapshot: TypeScriptProjectSnapshot, proof: { readonly evidence: readonly FactId[] }) {
  expect(proof.evidence.length).toBeGreaterThan(0)
  const facts = await snapshot.query.factsById(proof.evidence)
  expect(new Set(facts.map(fact => fact.id))).toEqual(new Set(proof.evidence))
}

describe('generation-owned symbolic proof evidence', () => {
  it('reuses materialized constructor proofs after a demand retry without retaining the replaced catalogue', async () => {
    const { root, owners, refresh, open } = await fixture()
    const original = await open(), input = await coordinates(original)
    const certificate = (await original.facts.facts('body-demand')).facts[0]!.id
    const constructors: { readonly evidence: readonly FactId[] }[] = []
    const model: SymbolicCallModel<never> = context => context.call.targetOrigin?.package === '@fixture/definitions'
      ? context.argument(0)?.property('id') : undefined
    const observe = vi.fn(async (read: TypeScriptSemanticReader, coordinates: { definition: OccurrenceId; callee: OccurrenceId }) => {
      const values = await read.values({ call: model })
      const constructor = await values.value(coordinates.callee).resolve()
      constructors.push(constructor)
      return { constructor: { ...constructor }, id: { ...await values.value(coordinates.definition).resolve() } }
    })
    let receipt: import('../analysis/typescript/index.ts').TypeScriptBodyDemandReceipt | undefined
    try { await original.compute(observe, input) } catch (error) {
      expect(error).toBeInstanceOf(BodyDemandExpansionRequired)
      receipt = (error as BodyDemandExpansionRequired).receipt
    }
    expect(receipt).toBeDefined()
    await owned(original, constructors[0]!)
    for (const { owner } of receipt!.requirements) owners.add(owner)
    await refresh()
    const expanded = await open()
    expect(await expanded.query.factsById([certificate])).toEqual([])
    const result = await expanded.compute(observe, input)
    expect(result.constructor).toMatchObject({ kind: 'known', value: { kind: 'external', symbolOrigin: { package: '@fixture/definitions' } } })
    expect(result.id).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'first' } })
    await owned(expanded, result.constructor); await owned(expanded, result.id)
    expect(result.constructor.evidence).not.toContain(certificate)
    expect(constructors[1]).toBe(constructors[0])
    await owned(original, constructors[0]!)
    await expanded.compute(observe, input)
    expect(observe).toHaveBeenCalledTimes(2)
    await refresh()
    const noop = await open()
    const noopResult = await noop.compute(observe, input)
    await owned(noop, noopResult.constructor); await owned(noop, noopResult.id)
    expect(observe).toHaveBeenCalledTimes(2)
    await writeFile(join(root, 'unrelated.ts'), "export const unrelated = 'other'\n")
    await refresh(['unrelated.ts'])
    const unrelated = await open(), unchanged = await unrelated.compute(observe, input)
    await owned(unrelated, unchanged.constructor); await owned(unrelated, unchanged.id)
    // The ID reads a callable header from the replaced catalogue. Its physical
    // support must change, while the materialized constructor remains reusable.
    expect(observe).toHaveBeenCalledTimes(3)
    expect(constructors[2]).toBe(constructors[0])
    await writeFile(join(root, 'library.ts'), "export function helper() { return 'other' }; export function untouched(input: unknown) { return input };\n")
    await refresh(['library.ts'])
    const edited = await open(), changed = await edited.compute(observe, await coordinates(edited))
    await owned(edited, changed.constructor); await owned(edited, changed.id)
    expect(changed.id).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'other' } })
    const fresh = await openTypeScriptProject({ root,
      ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
      capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body-demand'],
    })
    projects.push(fresh)
    await fresh.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [...owners] } })
    const oracle = await fresh.open(); snapshots.push(oracle)
    const freshResult = await oracle.compute(observe, await coordinates(oracle))
    await owned(oracle, freshResult.constructor); await owned(oracle, freshResult.id)
    expect(changed).toEqual(freshResult)
    await writeFile(join(root, 'library.ts'), "export function helper() { return 'first' }; export function untouched(input: unknown) { return input };\n")
    await refresh(['library.ts'])
    const repaired = await open(), repair = await repaired.compute(observe, await coordinates(repaired))
    await owned(repaired, repair.constructor); await owned(repaired, repair.id)
    expect(repair.id).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'first' } })
    await expect(original.compute(observe, input)).rejects.toBeInstanceOf(BodyDemandExpansionRequired)
  })

  it('invalidates cited catalogue facts in both caches while preserving retained proof ownership and fresh equivalence', async () => {
    const { root, owners, refresh, open } = await fixture()
    const original = await open(), input = await coordinates(original)
    const observe = vi.fn(async (read: TypeScriptSemanticReader, occurrence: OccurrenceId) => ({ ...await (await read.values()).value(occurrence).resolve() }))
    const observeKeys = vi.fn(async (read: TypeScriptSemanticReader, occurrence: OccurrenceId) =>
      Object.fromEntries((await (await read.values()).value(occurrence).resolve()).evidence.map(id => [id, true])))
    const observeValue = vi.fn(async (read: TypeScriptSemanticReader, occurrence: OccurrenceId) => {
      const proof = await (await read.values()).value(occurrence).resolve()
      return { kind: proof.kind, invalidIdentityLiteral: 'fact:plain text' }
    })
    const raw = await (await original.values()).value(input.shape).resolve()
    const observeReuse = vi.fn(async (read: TypeScriptSemanticReader) => (await read.values()).canReuse(raw))
    const observeNested = vi.fn(async (read: TypeScriptSemanticReader, occurrence: OccurrenceId) => {
      const proof = await (await read.values()).value(occurrence).resolve()
      const shared: { evidence: readonly FactId[]; self?: unknown } = { evidence: proof.evidence }
      shared.self = shared
      return { nested: [shared, shared] }
    })
    const before = await original.compute(observe, input.shape)
    const beforeKeys = await original.compute(observeKeys, input.shape)
    const beforeValue = await original.compute(observeValue, input.shape)
    const beforeNested = await original.compute(observeNested, input.shape)
    expect(await original.compute(observeReuse, null)).toBe(true)
    const certificate = (await original.facts.facts('body-demand')).facts[0]!.id
    expect(before.evidence).toContain(certificate)
    await owned(original, before)
    const library = await loadValueIndex(original.query)
    owners.add([...library.symbols.values()].find(fact => fact.payload.name === 'helper')!.payload.symbol)
    await refresh()
    const expanded = await open(), after = await expanded.compute(observe, input.shape)
    expect((await expanded.values()).canReuse(raw)).toBe(false)
    await owned(expanded, after)
    expect(after.evidence).not.toContain(certificate)
    expect({ ...after, evidence: [] }).toEqual({ ...before, evidence: [] })
    expect(observe).toHaveBeenCalledTimes(2)
    const afterKeys = await expanded.compute(observeKeys, input.shape)
    await owned(expanded, { evidence: Object.keys(afterKeys) as FactId[] })
    expect(afterKeys).not.toHaveProperty(certificate)
    expect(observeKeys).toHaveBeenCalledTimes(2)
    expect(await expanded.compute(observeValue, input.shape)).toEqual(beforeValue)
    expect(observeValue).toHaveBeenCalledTimes(1)
    expect(await expanded.compute(observeReuse, null)).toBe(false)
    expect(observeReuse).toHaveBeenCalledTimes(2)
    const afterNested = await expanded.compute(observeNested, input.shape)
    await owned(expanded, afterNested.nested[0]!)
    expect(afterNested.nested[0]).toBe(afterNested.nested[1])
    expect(afterNested.nested[0]!.self).toBe(afterNested.nested[0])
    expect(observeNested).toHaveBeenCalledTimes(2)
    await owned(original, beforeNested.nested[0]!)
    await owned(original, before)
    await owned(original, { evidence: Object.keys(beforeKeys) as FactId[] })
    expect(await original.compute(observe, input.shape)).toEqual(before)
    owners.clear()
    await refresh()
    const restored = await open()
    expect(await restored.query.factsById([certificate])).toHaveLength(1)
    expect(await restored.compute(observeReuse, null)).toBe(true)
    expect(observeReuse).toHaveBeenCalledTimes(3)
    await owned(restored, raw)
    await writeFile(join(root, 'library.ts'), "export function helper() { return 'first' }; export function untouched(input: unknown, extra: unknown) { return extra };\n")
    await refresh(['library.ts'])
    const edited = await open(), changed = await edited.compute(observe, (await coordinates(edited)).shape)
    await owned(edited, changed)
    expect(changed).toMatchObject({ kind: 'known', value: { kind: 'function', parameterCount: 2 } })
    const fresh = await openTypeScriptProject({ root,
      ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
      capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body-demand'],
    })
    projects.push(fresh)
    await fresh.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [...owners] } })
    const oracle = await fresh.open(); snapshots.push(oracle)
    const freshResult = await oracle.compute(observe, (await coordinates(oracle)).shape)
    await owned(oracle, freshResult)
    expect(changed).toEqual(freshResult)
  })
})

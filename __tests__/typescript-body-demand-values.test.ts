import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot, type TypeScriptSemanticReader } from '../analysis/typescript/index.ts'
import { IndexedValues, loadValueIndex, type IndexedFact } from '../analysis/typescript/value/symbolic/facts.ts'
import { createValueEvaluatorFactory } from '../analysis/typescript/value/symbolic/engine.ts'
import { callSelectionKeys } from '../analysis/typescript/value/symbolic/selection.ts'

const roots: string[] = []
const projects: TypeScriptProject[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(projects.splice(0).map((project) => project.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function open(root: string, demand: boolean) {
  const project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.source', 'typescript.symbol', 'typescript.occurrence', demand ? 'typescript.body-demand' : 'typescript.body'],
  })
  projects.push(project)
  return project
}
async function fixture(sibling: string) {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-body-demand-values-')); roots.push(root)
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] })),
    writeFile(join(root, 'shared.ts'), "export const object = { value: 'stable' }; export function identity(input: string) { return input }\n"),
    writeFile(join(root, 'selected.ts'), "import { object, identity } from './shared'; export const selected = object; export const call = identity('selected');\n"),
    writeFile(join(root, 'other.ts'), "export function other(input: string) { return input }; export const call = other('other');\n"),
    writeFile(join(root, 'sibling.ts'), `import { object } from './shared'; ${sibling}\n`),
    writeFile(join(root, 'unrelated.ts'), Array.from({ length: 16 }, (_, index) => `export function unrelated${index}() { return '${index}' }`).join('\n')),
  ])
  const full = await open(root, false), demand = await open(root, true)
  await full.refresh(); await demand.refresh({ bodyDemand: { paths: ['selected.ts'] } })
  return { root, full, demand }
}
async function selectedValue(snapshot: TypeScriptProjectSnapshot, maximumSteps?: number) {
  const index = await loadValueIndex(snapshot.query)
  const symbol = [...index.symbols.values()].find((fact) => fact.payload.name === 'selected')!.payload.symbol
  const initializer = index.initializers.get(symbol)![0]!
  const evaluator = await snapshot.values(maximumSteps ? { limits: { maximumSteps } } : {})
  const { evidence: _evidence, ...value } = await evaluator.value(initializer).resolve()
  return value
}
async function facts(snapshot: TypeScriptProjectSnapshot): Promise<IndexedFact[]> {
  const result: IndexedFact[] = []
  for (const kind of ['body', 'body-demand', 'symbol', 'source'] as const) for await (const fact of snapshot.facts.export(kind)) result.push(fact)
  return result
}

describe('symbolic values under revision-owned body demand', () => {
  it.each([
    ['mutation', "export function sibling() { object.value = 'changed' }"],
    ['alias mutation', "export function sibling() { const alias = object; alias.value = 'changed' }"],
    ['escape', 'declare function external(input: unknown): unknown; export function sibling() { external(object) }'],
    ['omitted local callable', 'function omitted(input: unknown) { return undefined }; export function sibling() { omitted(object) }'],
  ])('retains full value semantics for a sibling %s', async (_name, sibling) => {
    const { full, demand } = await fixture(sibling)
    const baseline = await full.open(), selected = await demand.open()
    try {
      const certificate = (await selected.facts.facts('body-demand')).facts[0]!
      expect(certificate.payload.completeness).toEqual({ kind: 'complete' })
      expect(certificate.payload.owners.some((owner) => !owner.materialized)).toBe(true)
      expect(await selectedValue(selected)).toEqual(await selectedValue(baseline))
      for (const steps of [3, 12, 32]) expect(await selectedValue(selected, steps)).toEqual(await selectedValue(baseline, steps))
      const actual = await selected.calls({ paths: ['selected.ts'] })
      expect(actual).toEqual(await baseline.calls({ paths: ['selected.ts'] }))
      expect(actual.completeness).toEqual({ kind: 'complete' })
      expect((await selected.calls()).completeness.kind).toBe('partial')
      expect((await selected.calls({ paths: ['unrelated.ts'] })).completeness.kind).toBe('partial')
      const source = actual.sites[0]!.occurrence.span.source
      expect(await selected.calls({ sources: [source] })).toEqual(actual)
      expect(await selected.calls({ sources: [source], paths: ['other.ts'] })).toEqual({ sites: [], completeness: { kind: 'complete' } })
      const index = await loadValueIndex(selected.query)
      for (const owner of certificate.payload.owners) expect(index.callableOwners.has(owner.owner)).toBe(true)
      for (const witness of certificate.payload.witnesses) expect(index.occurrences.get(witness.id)?.owner).toBe(witness.owner)
      const fullIndex = await loadValueIndex(baseline.query)
      expect([...index.mutations].sort()).toEqual([...fullIndex.mutations].sort())
      expect([...index.escapes].sort()).toEqual([...fullIndex.escapes].sort())
      expect([...index.aliases].sort()).toEqual([...fullIndex.aliases].sort())
      // Effects are contributed by the inventory once, rather than duplicated
      // by selected full bodies with overlapping initializer occurrences.
      expect([...index.initializers].sort()).toEqual([...fullIndex.initializers].sort())
    } finally { await baseline.dispose(); await selected.dispose() }
  })

  it('retires old materialized shards, invalidates scoped computations and recovers a failed lazy delta read', async () => {
    const { demand } = await fixture('export function sibling() { return object }')
    const before = await demand.open()
    const previousCalls = await before.calls({ paths: ['selected.ts'] })
    const observe = vi.fn(async (read: TypeScriptSemanticReader) => (await read.calls({ paths: ['selected.ts'] })).sites.map((site) => site.call.occurrence))
    const previous = await before.compute(observe, null)
    const update = await demand.refresh({ bodyDemand: { paths: ['other.ts'] } })
    expect(update.transactions.some((transaction) => transaction.deletes.length > 0)).toBe(true)
    const after = await demand.open()
    try {
      const read = vi.spyOn(after.query, 'factsById')
      read.mockRejectedValueOnce(new Error('interrupted demand index read'))
      await expect(after.calls({ paths: ['other.ts'] })).rejects.toThrow('interrupted demand index read')
      expect((await after.calls({ paths: ['other.ts'] })).completeness).toEqual({ kind: 'complete' })
      const retired = await after.calls({ paths: ['selected.ts'] })
      expect(retired.sites).toHaveLength(0)
      expect(retired.completeness.kind).toBe('partial')
      expect(await after.compute(observe, null)).toEqual([])
      expect(observe).toHaveBeenCalledTimes(2)
      expect(await before.compute(observe, null)).toEqual(previous)
      expect(await before.calls({ paths: ['selected.ts'] })).toEqual(previousCalls)
    } finally { await before.dispose(); await after.dispose() }
  })

  it('invalidates previously positive value proofs when foreign global effects change', async () => {
    const { root, full, demand } = await fixture('export function sibling() { return object }')
    const before = await demand.open()
    const index = await loadValueIndex(before.query)
    const symbol = [...index.symbols.values()].find((fact) => fact.payload.name === 'selected')!.payload.symbol
    const occurrence = index.initializers.get(symbol)![0]!
    const evaluator = await before.values()
    const proof = await evaluator.value(occurrence).resolve()
    expect(proof.kind).toBe('known')
    await writeFile(join(root, 'sibling.ts'), "import { object } from './shared'; export function sibling() { object.value = 'changed' }\n")
    await demand.refresh({ changed: ['sibling.ts'] }); await full.refresh({ changed: ['sibling.ts'] })
    const after = await demand.open(), oracle = await full.open()
    try {
      expect((await after.values()).canReuse(proof)).toBe(false)
      expect(await selectedValue(after)).toEqual(await selectedValue(oracle))
      expect((await after.values()).value(occurrence)).toBeDefined()
      expect(await evaluator.value(occurrence).resolve()).toEqual(proof)
    } finally { await before.dispose(); await after.dispose(); await oracle.dispose() }
  })

  it('rejects incomplete inventory authority without reusing a full-index positive proof', async () => {
    const { full, demand } = await fixture('export function sibling() { return object }')
    const baseline = await full.open(), selected = await demand.open()
    try {
      const original = await facts(baseline), certificate = (await selected.facts.facts('body-demand')).facts[0]!
      const fullIndex = IndexedValues.empty().update(original.filter((fact) => fact.namespace !== 'typescript.body-demand'), [], true)
      const symbol = [...fullIndex.symbols.values()].find((fact) => fact.payload.name === 'selected')!.payload.symbol
      const occurrence = fullIndex.initializers.get(symbol)![0]!
      const evaluator = await createValueEvaluatorFactory(baseline.query, undefined, async () => fullIndex)()
      const proof = await evaluator.value(occurrence).resolve()
      expect(proof.kind).toBe('known')
      const incomplete = { ...certificate, payload: { ...certificate.payload, completeness: { kind: 'unavailable' as const, reasons: [{ code: 'TEST_INVENTORY_INTERRUPTED', message: 'Interrupted inventory', retryable: true }] } } }
      const after = fullIndex.update([incomplete], [])
      const next = await createValueEvaluatorFactory(selected.query, undefined, async () => after)()
      expect(next.canReuse(proof)).toBe(false)
      const unknown = await next.value(occurrence).resolve()
      expect(unknown).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_EFFECT_INVENTORY_INCOMPLETE' })] })
      expect(unknown.evidence).toContain(certificate.id)
      expect(after.revision.changed.has('effects:inventory')).toBe(true)
      const keys = callSelectionKeys({ paths: ['selected.ts'] })
      const scoped = await loadValueIndex(selected.query)
      const materialized = certificate.payload.owners.find((owner) => owner.fact)!
      const forged = { ...certificate, payload: { ...certificate.payload, owners: certificate.payload.owners.map((owner) =>
        owner === materialized ? { ...owner, fact: certificate.id } : owner) } }
      expect(() => scoped.update([forged], [])).toThrow('materialized-owner-fact')
      const narrowed = scoped.update([{ ...certificate, payload: { ...certificate.payload, coverage: [] } }], [])
      expect(keys.some((key) => narrowed.revision.changed.has(key))).toBe(true)
    } finally { await baseline.dispose(); await selected.dispose() }
  })
})

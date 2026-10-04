import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, BodyDemandExpansionRequired, type TypeScriptBodyDemandReceipt, type TypeScriptProject, type TypeScriptProjectSnapshot, type BoundedValueLimits } from '../analysis/typescript/index.ts'
import { loadValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'
import type { SymbolId } from '../analysis/identity/index.ts'

const roots: string[] = [], projects: TypeScriptProject[] = []
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(aliases = 0) {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-body-expansion-')); roots.push(root)
  await Promise.all([
    writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] })),
    writeFile(join(root, 'selected.ts'), "import { collect, helper } from './library'; export const modeled = collect({ known: 'selected', ignored: helper() }); export const plain = helper();\n"),
    writeFile(join(root, 'library.ts'), "export const shared = { value: 'stable' }; export function helper() { return shared }; export function collect(input: unknown) { return input };\n"),
    ...Array.from({ length: aliases }, (_, index) => writeFile(join(root, `alias-${index}.ts`), `import { shared } from './library'; export function alias${index}() { const copy${index} = shared; return copy${index} };\n`)),
  ])
  const options = { root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) }
  const full = await openTypeScriptProject({ ...options, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'] })
  const demand = await openTypeScriptProject({ ...options, capabilities: ['typescript.source', 'typescript.symbol', 'typescript.body-demand'] })
  projects.push(full, demand)
  await full.refresh(); await demand.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [] } })
  return { root, full, demand }
}
async function initializer(snapshot: TypeScriptProjectSnapshot, name: string) {
  const index = await loadValueIndex(snapshot.query)
  const symbol = [...index.symbols.values()].find((fact) => fact.payload.name === name)!.payload.symbol
  return index.initializers.get(symbol)![0]!
}
async function replay(project: TypeScriptProject, name: string, limits?: BoundedValueLimits) {
  const owners = new Set<SymbolId>(), receipts: TypeScriptBodyDemandReceipt[] = []
  for (let attempt = 0; attempt < 16; attempt++) {
    const snapshot = await project.open()
    try {
      const evaluator = await snapshot.values()
      const proof = await evaluator.value(await initializer(snapshot, name)).resolve({ limits })
      return { proof, owners, receipts }
    } catch (error) {
      if (!(error instanceof BodyDemandExpansionRequired)) throw error
      expect(error.receipt.generation).toBe(snapshot.generation.id)
      expect(error.receipt.sourceManifest).toBe(snapshot.generation.sourceManifest)
      expect(Object.isFrozen(error.receipt)).toBe(true)
      expect(Object.isFrozen(error.receipt.requirements)).toBe(true)
      expect(error.receipt.requirements.every((requirement) => Object.isFrozen(requirement))).toBe(true)
      const size = owners.size
      for (const requirement of error.receipt.requirements) owners.add(requirement.owner)
      expect(owners.size).toBeGreaterThan(size)
      receipts.push(error.receipt)
    } finally { await snapshot.dispose() }
    await project.refresh({ bodyDemand: { paths: ['selected.ts'], owners: [...owners] } })
  }
  throw new Error('Expansion fixture failed to reach a receipt-free result.')
}

function result(proof: { readonly evidence: unknown }) { const { evidence: _evidence, ...value } = proof; return value }

describe('actual-read body demand expansion', () => {
  it('lets a model read one object property without loading an ignored call or its DSL implementation', async () => {
    const { full, demand } = await fixture()
    const snapshot = await demand.open(), oracle = await full.open()
    try {
      const index = await loadValueIndex(snapshot.query)
      const collect = [...index.symbols.values()].find((fact) => fact.payload.name === 'collect')!.payload.symbol
      const helper = [...index.symbols.values()].find((fact) => fact.payload.name === 'helper')!.payload.symbol
      expect(index.bodies.has(collect)).toBe(false); expect(index.bodies.has(helper)).toBe(false)
      const model = (context: import('../analysis/typescript/index.ts').SymbolicCallContext<never>) => context.call.target === collect ? context.argument(0)?.property('known') : undefined
      const evaluator = await snapshot.values({ call: model }), baseline = await oracle.values({ call: model })
      const occurrence = await initializer(snapshot, 'modeled')
      expect(result(await evaluator.value(occurrence).resolve())).toEqual(result(await baseline.value(occurrence).resolve()))
      expect(await evaluator.value(occurrence).resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'selected' } })
    } finally { await snapshot.dispose(); await oracle.dispose() }
  })

  it('expands the true unmodeled body and imported initializer frontier, preserving old pins', async () => {
    const { full, demand } = await fixture()
    const pinned = await demand.open()
    const occurrence = await initializer(pinned, 'plain')
    const before = await pinned.values()
    await expect(before.value(occurrence).resolve()).rejects.toBeInstanceOf(BodyDemandExpansionRequired)
    const actual = await replay(demand, 'plain'), oracle = await full.open()
    try {
      expect(actual.receipts.length).toBeGreaterThan(0)
      expect(result(actual.proof)).toEqual(result(await (await oracle.values()).value(await initializer(oracle, 'plain')).resolve()))
      await expect(before.value(occurrence).resolve()).rejects.toBeInstanceOf(BodyDemandExpansionRequired)
    } finally { await pinned.dispose(); await oracle.dispose() }
  })

  it('requests original ordering IDs for multiple contributor owners before consuming their alias list', async () => {
    const { full, demand } = await fixture(2)
    const actual = await replay(demand, 'plain'), oracle = await full.open()
    try {
      const ordered = actual.receipts.flatMap((receipt) => receipt.requirements.filter((requirement) => requirement.kind === 'effect-order'))
      expect(ordered).toHaveLength(2)
      expect(result(actual.proof)).toEqual(result(await (await oracle.values()).value(await initializer(oracle, 'plain')).resolve()))
    } finally { await oracle.dispose() }
  })

  it.each([3, 12, 32])('retains full proof reasons and candidates at a %i step budget after replay', async (maximumSteps) => {
    const { full, demand } = await fixture(2)
    const limits = { maximumSteps }
    const actual = await replay(demand, 'plain', limits), oracle = await full.open()
    try {
      const baseline = await (await oracle.values()).value(await initializer(oracle, 'plain')).resolve({ limits })
      expect(result(actual.proof)).toEqual(result(baseline))
    } finally { await oracle.dispose() }
  })

  it('does not load a single-owner alias contributor merely to order its own rows', async () => {
    const { demand } = await fixture(1)
    const actual = await replay(demand, 'plain'), snapshot = await demand.open()
    try {
      expect(actual.receipts.every((receipt) => receipt.requirements.every((requirement) => requirement.kind === 'body'))).toBe(true)
      const index = await loadValueIndex(snapshot.query)
      const alias = [...index.symbols.values()].find((fact) => fact.payload.name === 'alias0')!.payload.symbol
      expect(index.callableOwners.has(alias)).toBe(true)
      expect(index.bodies.has(alias)).toBe(false)
    } finally { await snapshot.dispose() }
  })

  it.each(['return', 'throw'] as const)('retains expansion when a model catches missing input and tries to %s', async (action) => {
    const { demand } = await fixture()
    const snapshot = await demand.open()
    try {
      const index = await loadValueIndex(snapshot.query)
      const collect = [...index.symbols.values()].find((fact) => fact.payload.name === 'collect')!.payload.symbol
      const model = (context: import('../analysis/typescript/index.ts').SymbolicCallContext<string>) => {
        if (context.call.target !== collect) return
        try { context.argument(0)?.property('ignored').resolve() } catch {
          if (action === 'throw') throw new Error('masked expansion')
          return { kind: 'atom' as const, value: 'caught' }
        }
      }
      const evaluator = await snapshot.values({ call: model }), occurrence = await initializer(snapshot, 'modeled')
      for (let attempt = 0; attempt < 2; attempt++) await expect(evaluator.value(occurrence).resolve()).rejects.toBeInstanceOf(BodyDemandExpansionRequired)
      const observe = vi.fn(async (read: import('../analysis/typescript/index.ts').TypeScriptSemanticReader) =>
        (await read.values({ call: model })).value(occurrence).resolve())
      for (let attempt = 0; attempt < 2; attempt++) await expect(snapshot.compute(observe, null)).rejects.toBeInstanceOf(BodyDemandExpansionRequired)
      expect(observe).toHaveBeenCalledTimes(2)
    } finally { await snapshot.dispose() }
  })
})

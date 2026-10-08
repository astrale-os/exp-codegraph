import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot, type TypeScriptSourceFact } from '../analysis/typescript/index.ts'
import { inspectSourceSymbol } from '../qualification/v2/structural/navigation-consumer.ts'
import { createNavigationOracle, orderNavigationLocations } from '../qualification/v2/structural/navigation-oracle.ts'

const roots: string[] = []
const projects: TypeScriptProject[] = []
const snapshots: TypeScriptProjectSnapshot[] = []
const native = process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}
const api = `export function api(value: string): string { return value }
export function overloaded(value: string): string
export function overloaded(value: number): number
export function overloaded(value: string | number): string | number { return value }
`
const consumer = `// Unicode before every use: 🧭 café
import { renamed as invoke } from './public.js'
import * as apiModule from './api.js'
import { overloaded } from './api.js'
export const direct = invoke('one')
export const shorthand = { invoke }
export const qualified = apiModule.api('two')
export const many = overloaded('overload')
export const literal = apiModule['api']('three')
declare const key: string
export const computed = apiModule[key]
`
const locals = `// Private and shadowed bindings: 🧭 café
function left(input: string) { const value = input; return value }
function right(input: string) { const value = input; return value }
function hidden(value: string) { return value }
class Holder { #value = 1; read() { return this.#value } }
export const pair = [left('left'), right('right')]
export const hiddenUse = hidden('hidden')
export const read = new Holder().read()
`

afterEach(async () => {
  await Promise.all(snapshots.splice(0).map((snapshot) => snapshot.dispose()))
  await Promise.all(projects.splice(0).map((project) => project.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function open(root: string, capabilities = ['typescript.source', 'typescript.structure']) {
  const project = await openTypeScriptProject({ root, capabilities, ...native })
  projects.push(project)
  await project.refresh()
  return project
}

async function snapshot(project: TypeScriptProject) {
  const result = await project.open()
  snapshots.push(result)
  return result
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-navigation-'))
  roots.push(root)
  const files = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { noLib: true, noEmit: true, strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] }),
    'api.ts': api,
    'barrel.ts': "export { api as renamed } from './api.js'\n",
    'public.ts': "export * from './barrel.js'\n",
    'consumer.ts': consumer,
    'locals.ts': locals,
    'empty.ts': 'export {}\n',
  }
  await Promise.all(Object.entries(files).map(([path, text]) => writeFile(join(root, path), text)))
  const project = await open(root)
  return { root, project, pinned: await snapshot(project) }
}

function at(text: string, fragment: string, token: string, last = false) {
  const start = text.indexOf(fragment)
  const relative = last ? fragment.lastIndexOf(token) : fragment.indexOf(token)
  if (start < 0 || relative < 0) throw new Error(`Missing authored token: ${fragment}:${token}`)
  return start + relative
}

function locations(rows: readonly { readonly path: string; readonly span: { readonly start: number; readonly end: number } }[]) {
  return rows.map(({ path, span }) => ({ path, start: span.start, end: span.end })).sort(orderNavigationLocations)
}

async function sources(pinned: TypeScriptProjectSnapshot) {
  const result = new Map<string, TypeScriptSourceFact>()
  for await (const fact of pinned.facts.export('source')) result.set(fact.payload.logicalPath, fact.payload)
  return result
}

describe('position-first public semantic navigation', () => {
  it('matches an independent compiler for aliases, shorthand, namespace, private bindings, shadowing and all overload declarations', async () => {
    const { root, pinned } = await fixture()
    const oracle = createNavigationOracle(root)
    const sourceFacts = await sources(pinned)
    const structure = await pinned.structure()
    const selections = [
      { path: 'consumer.ts', offset: at(consumer, "invoke('one')", 'invoke') },
      { path: 'consumer.ts', offset: at(consumer, '{ invoke }', 'invoke') },
      { path: 'consumer.ts', offset: at(consumer, '.api(', 'api') },
      { path: 'consumer.ts', offset: at(consumer, "overloaded('overload')", 'overloaded') },
      { path: 'locals.ts', offset: at(locals, "hidden('hidden')", 'hidden') },
      { path: 'locals.ts', offset: at(locals, 'return this.#value', '#value') },
      { path: 'locals.ts', offset: at(locals, 'function left(input: string) { const value = input; return value }', 'input', true) },
      { path: 'locals.ts', offset: at(locals, 'function right(input: string) { const value = input; return value }', 'input', true) },
      { path: 'locals.ts', offset: at(locals, 'function left(input: string) { const value = input; return value }', 'value', true) },
      { path: 'locals.ts', offset: at(locals, 'function right(input: string) { const value = input; return value }', 'value', true) },
      { path: 'consumer.ts', offset: at(consumer, "apiModule['api']", "'api'") + 1 },
      { path: 'consumer.ts', offset: at(consumer, 'apiModule[key]', 'key') },
    ]
    const targets: string[] = []
    for (const input of selections) {
      const report = await pinned.compute(inspectSourceSymbol, input)
      const expected = oracle.symbolAt(input.path, input.offset)
      expect(report.navigation.target.kind).toBe('resolved')
      expect(locations(report.navigation.sites)).toEqual(expected.sites)
      expect(report.navigation.symbols.map((symbol) => ({ name: symbol.name, declarations: locations(symbol.declarations) }))).toEqual(expected.symbols)
      expect(locations(report.references.references)).toEqual(expected.references)
      const source = sourceFacts.get(input.path)!
      expect(report.navigation.source).toEqual({ source: source.source, revision: source.revision, logicalPath: source.logicalPath, textDigest: source.textDigest })
      expect(report.navigation.evidence.length).toBeGreaterThan(0)
      for (const symbol of report.navigation.symbols) for (const declaration of symbol.declarations) {
        expect(declaration.span.source).toBe(sourceFacts.get(declaration.path)?.source)
        expect(declaration.span.revision).toBe(sourceFacts.get(declaration.path)?.revision)
      }
      targets.push(report.navigation.symbols[0]!.symbol)
      expect(Object.isFrozen(report)).toBe(true)
    }
    expect(targets[0]).toBe(targets[1])
    expect(targets[0]).toBe(targets[2])
    expect(targets[0]).toBe(targets[10])
    expect(targets[6]).not.toBe(targets[7])
    expect(targets[8]).not.toBe(targets[9])
    const overloaded = await structure.symbolAt(selections[3]!)
    expect(overloaded.symbols[0]!.declarations).toHaveLength(3)
    const privateHelper = await structure.references({ target: { path: 'locals.ts', name: 'hidden' } })
    expect(privateHelper.target.kind).toBe('missing')
    const computedPunctuation = await structure.symbolAt({ path: 'consumer.ts', offset: at(consumer, 'apiModule[key]', '[') })
    expect(computedPunctuation.target.kind).toBe('unavailable')
    expect(computedPunctuation.symbols).toEqual([])
    expect(computedPunctuation.sites).toHaveLength(1)
    expect(computedPunctuation.sites[0]!.symbol).toBeUndefined()
    for await (const fact of pinned.facts.exportAll()) expect(fact.namespace).not.toBe('typescript.body')
  })

  it('reports stale expected revisions without resolving a position against different text and keeps old pins usable', async () => {
    const { root, project, pinned } = await fixture()
    const initialSource = (await sources(pinned)).get('consumer.ts')!
    const initialInput = { path: 'consumer.ts', offset: at(consumer, "invoke('one')", 'invoke'), revision: initialSource.revision }
    const original = await pinned.compute(inspectSourceSymbol, initialInput)
    const editedText = `// Moved again: 🧭 café\n${consumer}`
    await writeFile(join(root, 'consumer.ts'), editedText)
    await project.refresh({ changed: ['consumer.ts'] })
    const current = await snapshot(project)
    const currentSource = (await sources(current)).get('consumer.ts')!
    const offset = at(editedText, "invoke('one')", 'invoke')
    const stale = await current.compute(inspectSourceSymbol, { ...initialInput, offset })
    expect(stale.navigation.target).toEqual({ kind: 'stale', expectedRevision: initialSource.revision, actualRevision: currentSource.revision })
    expect(stale.navigation.symbols).toEqual([])
    expect(stale.navigation.sites).toEqual([])
    expect(stale.references.references).toEqual([])
    expect(stale.references.target).toEqual(stale.navigation.target)
    const input = { path: 'consumer.ts', offset, revision: currentSource.revision }
    const correct = await current.compute(inspectSourceSymbol, input)
    expect(correct.navigation.target.kind).toBe('resolved')
    expect(locations(correct.navigation.sites)).toEqual(createNavigationOracle(root).symbolAt(input.path, input.offset).sites)
    expect(correct).toEqual(await (await snapshot(await open(root))).compute(inspectSourceSymbol, input))
    expect(await pinned.compute(inspectSourceSymbol, initialInput)).toEqual(original)
  })

  it('resolves source positions and declaration paths with only structural capability', async () => {
    const { root } = await fixture()
    const lean = await snapshot(await open(root, ['typescript.structure']))
    const input = { path: 'consumer.ts', offset: at(consumer, "invoke('one')", 'invoke') }
    const report = await lean.compute(inspectSourceSymbol, input)
    const oracle = createNavigationOracle(root).symbolAt(input.path, input.offset)
    expect(report.navigation.target.kind).toBe('resolved')
    expect(report.navigation.source?.logicalPath).toBe(input.path)
    expect(report.navigation.symbols.map((symbol) => ({ name: symbol.name, declarations: locations(symbol.declarations) }))).toEqual(oracle.symbols)
    expect(report.navigation.symbols[0]!.declarations[0]!.path).toBe('api.ts')
    expect(locations(report.references.references)).toEqual(oracle.references)
    expect((await lean.facts.facts('source')).facts).toEqual([])
    for await (const fact of lean.facts.exportAll()) expect(fact.namespace).toBe('typescript.structure')
  })

  it('reuses position inspection after unrelated edits, then refreshes use and declaration evidence with cold equality', async () => {
    const { root, project, pinned } = await fixture()
    const input = { path: 'consumer.ts', offset: at(consumer, "invoke('one')", 'invoke') }
    let executions = 0
    const observe: typeof inspectSourceSymbol = async (read, position) => {
      executions++
      return inspectSourceSymbol(read, position)
    }
    const original = await pinned.compute(observe, input)
    await writeFile(join(root, 'empty.ts'), 'export const unrelated = 2\n')
    await project.refresh({ changed: ['empty.ts'] })
    const unrelated = await snapshot(project)
    expect(await unrelated.compute(observe, input)).toEqual(original)
    expect(executions).toBe(1)
    await writeFile(join(root, 'consumer.ts'), consumer.replace("invoke('one')", "invoke('two')"))
    await project.refresh({ changed: ['consumer.ts'] })
    const edited = await snapshot(project)
    const changed = await edited.compute(observe, input)
    expect(executions).toBe(2)
    expect(changed.navigation.source?.revision).not.toBe(original.navigation.source?.revision)
    expect(changed).toEqual(await (await snapshot(await open(root))).compute(inspectSourceSymbol, input))
    await writeFile(join(root, 'api.ts'), `// Declaration moved: 🧭 café\n${api}`)
    await project.refresh({ changed: ['api.ts'] })
    const relocated = await snapshot(project)
    const declarationChanged = await relocated.compute(observe, input)
    expect(executions).toBe(3)
    expect(declarationChanged.navigation.symbols[0]!.declarations[0]!.span.revision).not.toBe(changed.navigation.symbols[0]!.declarations[0]!.span.revision)
    expect(declarationChanged).toEqual(await (await snapshot(await open(root))).compute(inspectSourceSymbol, input))
    expect(await pinned.compute(observe, input)).toEqual(original)
    expect(await readFile(join(root, 'public.ts'), 'utf8')).toBe("export * from './barrel.js'\n")
  })

  it('distinguishes an empty represented position from an unavailable source and respects cancellation and reader lifetime', async () => {
    const { pinned } = await fixture()
    const structure = await pinned.structure()
    const empty = await structure.symbolAt({ path: 'empty.ts', offset: 0 })
    expect(empty.target.kind).toBe('missing')
    expect(empty.symbols).toEqual([])
    expect(empty.sites).toEqual([])
    expect(empty.completeness).toEqual({ kind: 'complete' })
    const absent = await structure.symbolAt({ path: 'not-loaded.ts', offset: 0 })
    expect(absent.target.kind).toBe('unavailable')
    expect(absent.completeness.kind).toBe('unavailable')
    await expect(structure.symbolAt({ path: 'consumer.ts', offset: 0, signal: AbortSignal.abort(new Error('superseded')) })).rejects.toThrow('superseded')
    await pinned.dispose()
    await expect(structure.symbolAt({ path: 'consumer.ts', offset: 0 })).rejects.toThrow('disposed')
  })
})

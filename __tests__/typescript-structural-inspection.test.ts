import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot, type TypeScriptSemanticReader, type TypeScriptSourceFact, type TypeScriptStructuralReader } from '../analysis/typescript/index.ts'
import { inspectStructuralAPI } from '../qualification/v2/structural/consumer.ts'
import { createStructuralOracle, orderLocations } from '../qualification/v2/structural/oracle.ts'

const roots: string[] = []
const projects: TypeScriptProject[] = []
const snapshots: TypeScriptProjectSnapshot[] = []
const input = { path: 'api.ts', name: 'api', module: 'api.ts' }
const native = process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}

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
  const pinned = await project.open()
  snapshots.push(pinned)
  return pinned
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-structural-'))
  roots.push(root)
  await cp(resolve(import.meta.dirname, '../qualification/v2/structural/fixtures/no-spec'), root, { recursive: true })
  const project = await open(root)
  return { root, project, pinned: await snapshot(project) }
}

function referenceLocations(rows: readonly { readonly path: string; readonly span: { readonly start: number; readonly end: number } }[]) {
  return rows.map(({ path, span }) => ({ path, start: span.start, end: span.end })).sort(orderLocations)
}

async function expectOracle(root: string, pinned: TypeScriptProjectSnapshot) {
  const oracle = createStructuralOracle(root)
  const structure = await pinned.structure()
  const sources = new Map<string, TypeScriptSourceFact>()
  for await (const fact of pinned.facts.export('source')) sources.set(fact.payload.logicalPath, fact.payload)
  for (const name of ['api', 'Options', 'unused']) {
    const inventory = await structure.references({ target: { path: 'api.ts', name } })
    expect(inventory.target.kind).toBe('resolved')
    expect(inventory.evidence.length).toBeGreaterThan(0)
    expect(referenceLocations(inventory.references)).toEqual(oracle.references('api.ts', name).map(({ text: _text, ...location }) => location))
    for (const row of inventory.references) {
      expect(row.span.source).toMatch(/^source:/)
      expect(row.span.revision).toMatch(/^source-revision:/)
      expect(row.span.source).toBe(sources.get(row.path)?.source)
      expect(row.span.revision).toBe(sources.get(row.path)?.revision)
    }
  }
}

describe('public structural inspection consumer without specification or body facts', () => {
  it('matches an independent compiler oracle for aliases, barrels, namespace, shorthand, types and module edges', async () => {
    const { root, pinned } = await fixture()
    await expect(stat(join(root, '.spec'))).rejects.toThrow()
    await expectOracle(root, pinned)
    const structure = await pinned.structure()
    const exported = await structure.exports({ path: 'public.ts' })
    expect(exported.exports.map((row) => row.name).sort()).toEqual(['Options', 'renamed'])
    const throughBarrel = await structure.references({ target: { path: 'public.ts', name: 'renamed' } })
    expect(referenceLocations(throughBarrel.references)).toEqual(createStructuralOracle(root).references('api.ts', 'api').map(({ text: _text, ...location }) => location))
    const imports = await structure.dependencies()
    const expected = createStructuralOracle(root).imports().map(({ text: _text, ...edge }) => edge)
    const actual = imports.dependencies.map((edge) => ({
      path: edge.path, start: edge.span.start, end: edge.span.end,
      kind: edge.kind, typeOnly: edge.typeOnly,
      ...(edge.specifier === undefined ? {} : { specifier: edge.specifier }),
      ...(edge.targetPath === undefined ? {} : { targetPath: edge.targetPath }),
    })).sort(orderLocations)
    expect(actual).toEqual(expected)
    expect(imports.completeness.kind).toBe('partial')
    expect(imports.evidence.length).toBeGreaterThan(0)
    const sourceFacts = (await pinned.facts.facts('source')).facts
    for (const edge of imports.dependencies) {
      const source = sourceFacts.find((fact) => fact.payload.logicalPath === edge.path)?.payload
      expect(edge.span.source).toBe(source?.source)
      expect(edge.span.revision).toBe(source?.revision)
    }
    expect(await structure.dependencies({ paths: ['empty.ts'] })).toMatchObject({ dependencies: [], completeness: { kind: 'complete' } })
    const withDeclaration = await structure.references({ target: { path: 'api.ts', name: 'api' }, includeDeclarations: true })
    expect(referenceLocations(withDeclaration.references)).toEqual(createStructuralOracle(root).references('api.ts', 'api', true).map(({ text: _text, ...location }) => location))
    const missing = await structure.references({ target: { path: 'api.ts', name: 'doesNotExist' } })
    expect(missing.target.kind).toBe('missing')
    expect(missing.references).toEqual([])
    const completeEmpty = await structure.references({ target: { path: 'api.ts', name: 'unused' }, paths: ['empty.ts'] })
    expect(completeEmpty.references).toEqual([])
    expect(completeEmpty.completeness).toEqual({ kind: 'complete' })
    const report = await pinned.compute(inspectStructuralAPI, input)
    expect(report.references.references).toHaveLength(9)
    expect(Object.isFrozen(report)).toBe(true)
    expect(report.direct.dependents.map((row) => row.path).sort()).toEqual(['barrel.ts', 'consumer.ts', 'cycle-b.ts'])
    expect(report.transitive.dependents.map((row) => row.path).sort()).toEqual(['barrel.ts', 'consumer.ts', 'cycle-a.ts', 'cycle-b.ts', 'public.ts'])
    expect(report.direct.completeness.kind).toBe('partial')
    expect(report.transitive.completeness.kind).toBe('partial')
    for (const dependent of report.transitive.dependents) {
      expect(dependent.via[0]?.path).toBe(dependent.path)
      expect(dependent.via.at(-1)?.targetPath).toBe('api.ts')
    }
    const allFacts = []
    for await (const fact of pinned.facts.exportAll()) allFacts.push(fact)
    expect(allFacts.some((fact) => fact.namespace === 'typescript.body' || fact.namespace === 'astrale.typescript.module')).toBe(false)
  })

  it('pins revisions while additions, edits and deletion match fresh compiler answers', async () => {
    const { root, project, pinned } = await fixture()
    const original = await pinned.compute(inspectStructuralAPI, input)
    await writeFile(join(root, 'late.ts'), "import { renamed as use } from './public.js'; export const result = use('late')\n")
    await project.refresh({ changed: ['late.ts'] })
    const added = await snapshot(project)
    await expectOracle(root, added)
    expect(await added.compute(inspectStructuralAPI, input)).toEqual(await (await snapshot(await open(root))).compute(inspectStructuralAPI, input))
    const lateBefore = (await (await added.structure()).references({ target: { path: 'api.ts', name: 'api' }, paths: ['late.ts'] })).references
    await writeFile(join(root, 'late.ts'), "// different UTF-16 offsets and revision\nimport { api } from './api.js'; export const result = api('edited')\n")
    await project.refresh({ changed: ['late.ts'] })
    const edited = await snapshot(project)
    await expectOracle(root, edited)
    const lateAfter = (await (await edited.structure()).references({ target: { path: 'api.ts', name: 'api' }, paths: ['late.ts'] })).references
    expect(lateAfter[0]!.span.revision).not.toBe(lateBefore[0]!.span.revision)
    expect(await edited.compute(inspectStructuralAPI, input)).toEqual(await (await snapshot(await open(root))).compute(inspectStructuralAPI, input))
    await rm(join(root, 'late.ts'))
    await project.refresh({ changes: [{ path: 'late.ts', kind: 'unlink' }] })
    const removed = await snapshot(project)
    await expectOracle(root, removed)
    expect(await removed.compute(inspectStructuralAPI, input)).toEqual(await (await snapshot(await open(root))).compute(inspectStructuralAPI, input))
    expect(await pinned.compute(inspectStructuralAPI, input)).toEqual(original)
    expect((await (await added.structure()).references({ target: { path: 'api.ts', name: 'api' }, paths: ['late.ts'] })).references).toEqual(lateBefore)
  })

  it('invalidates tracked absence and unavailable selections after edits and file creation', async () => {
    const { root, project, pinned } = await fixture()
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader, paths: readonly string[]) => {
      executions++
      return (await read.structure()).references({ target: { path: 'api.ts', name: 'unused' }, paths })
    }
    const absent = await pinned.compute(observe, ['new.ts'])
    expect(absent.references).toEqual([])
    expect(absent.completeness).toMatchObject({ kind: 'unavailable', reasons: [expect.objectContaining({ code: 'STRUCTURAL_SOURCE_UNAVAILABLE' })] })
    const missingDependencies = await (await pinned.structure()).dependencies({ paths: ['new.ts'] })
    expect(missingDependencies.dependencies).toEqual([])
    expect(missingDependencies.completeness).toMatchObject({ kind: 'unavailable', reasons: [expect.objectContaining({ code: 'STRUCTURAL_SOURCE_UNAVAILABLE' })] })
    expect(await pinned.compute(observe, ['new.ts'])).toEqual(absent)
    expect(executions).toBe(1)
    await writeFile(join(root, 'new.ts'), "import { unused } from './api.js'; export const value = unused\n")
    await project.refresh({ changed: ['new.ts'] })
    const current = await snapshot(project)
    expect((await current.compute(observe, ['new.ts'])).references).toHaveLength(2)
    expect(executions).toBe(2)
    const zero = await current.compute(observe, ['empty.ts'])
    expect(zero.references).toEqual([])
    expect(zero.completeness).toEqual({ kind: 'complete' })
    await writeFile(join(root, 'empty.ts'), "import { unused } from './api.js'; export const value = { unused }\n")
    await project.refresh({ changed: ['empty.ts'] })
    const changed = await snapshot(project)
    expect((await changed.compute(observe, ['empty.ts'])).references).toHaveLength(2)
    expect(executions).toBe(4)
    expect(await pinned.compute(observe, ['new.ts'])).toEqual(absent)
  })

  it('retargets unchanged consumer aliases after a barrel changes ownership', async () => {
    const { root, project, pinned } = await fixture()
    const previous = await pinned.compute(inspectStructuralAPI, input)
    const consumerText = await readFile(join(root, 'consumer.ts'), 'utf8')
    await writeFile(join(root, 'alternate.ts'), 'export function api(value: string): string { return value }\n')
    await writeFile(join(root, 'barrel.ts'), "export { api as renamed } from './alternate.js'\nexport type { Options } from './api.js'\n")
    await project.refresh({ changed: ['alternate.ts', 'barrel.ts'] })
    const current = await snapshot(project)
    await expectOracle(root, current)
    const oracle = createStructuralOracle(root)
    const structure = await current.structure()
    const alternate = await structure.references({ target: { path: 'alternate.ts', name: 'api' } })
    expect(referenceLocations(alternate.references)).toEqual(oracle.references('alternate.ts', 'api').map(({ text: _text, ...location }) => location))
    expect(alternate.references.some((row) => row.path === 'consumer.ts')).toBe(true)
    expect(await readFile(join(root, 'consumer.ts'), 'utf8')).toBe(consumerText)
    expect(await current.compute(inspectStructuralAPI, input)).toEqual(await (await snapshot(await open(root))).compute(inspectStructuralAPI, input))
    expect(await pinned.compute(inspectStructuralAPI, input)).toEqual(previous)
  })

  it('reuses scoped references after an unrelated edit and invalidates after the selected source changes', async () => {
    const { root, project, pinned } = await fixture()
    let executions = 0
    const observe = async (read: TypeScriptSemanticReader, path: string) => {
      executions++
      return (await read.structure()).references({ target: { path: 'api.ts', name: 'api' }, paths: [path] })
    }
    const original = await pinned.compute(observe, 'consumer.ts')
    await writeFile(join(root, 'empty.ts'), 'export const unrelated = 2\n')
    await project.refresh({ changed: ['empty.ts'] })
    const unrelated = await snapshot(project)
    expect(await unrelated.compute(observe, 'consumer.ts')).toEqual(original)
    expect(executions).toBe(1)
    await writeFile(join(root, 'consumer.ts'), `${await readFile(join(root, 'consumer.ts'), 'utf8')}\nexport const extra = namespace.api('extra')\n`)
    await project.refresh({ changed: ['consumer.ts'] })
    const selected = await snapshot(project)
    const changed = await selected.compute(observe, 'consumer.ts')
    expect(executions).toBe(2)
    expect(changed.references).toHaveLength(original.references.length + 1)
    const fresh = await snapshot(await open(root))
    expect(changed).toEqual(await fresh.compute(observe, 'consumer.ts'))
    expect(referenceLocations(changed.references)).toEqual(createStructuralOracle(root).references('api.ts', 'api').filter((row) => row.path === 'consumer.ts').map(({ text: _text, ...location }) => location))
  })

  it('refreshes declaration evidence through unchanged barrels when the API source relocates', async () => {
    const { root, project, pinned } = await fixture()
    const before = await pinned.structure()
    const originalExports = await before.exports({ path: 'public.ts' })
    const originalReferences = await before.references({ target: { path: 'public.ts', name: 'renamed' } })
    const originalAPI = await readFile(join(root, 'api.ts'), 'utf8')
    const barrel = await readFile(join(root, 'barrel.ts'), 'utf8')
    const publicSource = await readFile(join(root, 'public.ts'), 'utf8')
    const originalSource = (await pinned.facts.facts('source')).facts.find((fact) => fact.payload.logicalPath === 'api.ts')!.payload
    await writeFile(join(root, 'api.ts'), `// Relocated declaration evidence: 🧭 café\n${originalAPI}`)
    await project.refresh({ changed: ['api.ts'] })
    const current = await snapshot(project)
    const structure = await current.structure()
    const currentExports = await structure.exports({ path: 'public.ts' })
    const currentReferences = await structure.references({ target: { path: 'public.ts', name: 'renamed' } })
    const currentSource = (await current.facts.facts('source')).facts.find((fact) => fact.payload.logicalPath === 'api.ts')!.payload
    expect(currentSource.revision).not.toBe(originalSource.revision)
    for (const exported of currentExports.exports) {
      expect(exported.declarations.length).toBeGreaterThan(0)
      for (const declaration of exported.declarations) {
        expect(declaration.source).toBe(currentSource.source)
        expect(declaration.revision).toBe(currentSource.revision)
      }
    }
    const fresh = await snapshot(await open(root))
    const cold = await fresh.structure()
    expect(currentExports).toEqual(await cold.exports({ path: 'public.ts' }))
    expect(currentReferences).toEqual(await cold.references({ target: { path: 'public.ts', name: 'renamed' } }))
    expect(await before.exports({ path: 'public.ts' })).toEqual(originalExports)
    expect(await before.references({ target: { path: 'public.ts', name: 'renamed' } })).toEqual(originalReferences)
    expect(originalExports.exports.every((exported) => exported.declarations.every((declaration) => declaration.revision === originalSource.revision))).toBe(true)
    expect(await readFile(join(root, 'barrel.ts'), 'utf8')).toBe(barrel)
    expect(await readFile(join(root, 'public.ts'), 'utf8')).toBe(publicSource)
  })

  it('does not report complete absence when structural extraction is unavailable and respects reader lifetime', async () => {
    const { root, pinned } = await fixture()
    const sourceOnly = await snapshot(await open(root, ['typescript.source']))
    const unavailable = await (await sourceOnly.structure()).references({ target: { path: 'api.ts', name: 'api' } })
    expect(unavailable.references).toEqual([])
    expect(unavailable.completeness.kind).toBe('unavailable')
    const structure = await pinned.structure()
    await expect(structure.references({ target: { path: 'api.ts', name: 'api' }, signal: AbortSignal.abort(new Error('superseded')) })).rejects.toThrow('superseded')
    let escaped: TypeScriptStructuralReader | undefined
    await pinned.compute(async (read) => {
      escaped = await read.structure()
      return (await escaped.exports({ path: 'api.ts' })).exports.length
    }, null)
    await expect(escaped!.references({ target: { path: 'api.ts', name: 'api' } })).rejects.toThrow()
    await pinned.dispose()
    await expect(structure.references({ target: { path: 'api.ts', name: 'api' } })).rejects.toThrow('disposed')
    expect(await readFile(join(root, 'api.ts'), 'utf8')).toContain('export function api')
  })
})

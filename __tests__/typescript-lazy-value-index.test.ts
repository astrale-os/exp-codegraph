import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, type TypeScriptProject } from '../analysis/typescript/index.ts'
import { projectPackedTypeScriptBody } from '../analysis/typescript/physical/index.ts'
import { IndexedValues } from '../analysis/typescript/value/symbolic/facts.ts'

const decoded = vi.hoisted(() => [] as string[])
vi.mock('../analysis/facts/representation/index.ts', async (load) => {
  const actual = await load<typeof import('../analysis/facts/representation/index.ts')>()
  return { ...actual, ownFactPayloadCodec: (codec: import('../analysis/facts/representation/index.ts').FactPayloadCodec) =>
    actual.ownFactPayloadCodec({ ...codec, decode(data: unknown) {
      decoded.push((data as { c: string[] }).c[2]!)
      return codec.decode(data)
    } }) }
})

const roots: string[] = []
const projects: TypeScriptProject[] = []
afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  decoded.length = 0
  vi.restoreAllMocks()
})
async function open(root: string) {
  const project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.body', 'typescript.symbol', 'typescript.source'],
  })
  projects.push(project)
  return project
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-lazy-index-'))
  roots.push(root)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] }))
  await writeFile(join(root, 'main.ts'), "import { helper } from './helper.js'; export const result = helper()\n")
  await writeFile(join(root, 'helper.ts'), "export const options = { count: 1 }; export function helper() { return options }\n")
  await writeFile(join(root, 'mutator.ts'), "import { options } from './helper.js'; export const unrelated = 0\n")
  await Promise.all(Array.from({ length: 16 }, (_, index) => writeFile(join(root, `other-${index}.ts`),
    `export function unused${index}(value: unknown) { const copy = { value }; return copy }\n`)))
  const project = await open(root)
  await project.refresh()
  return { root, project }
}

describe('lazy packed value fragments', () => {
  it('merges a wide source call catalogue once per changed slot', async () => {
    const { root, project } = await fixture()
    const count = 256
    await writeFile(join(root, 'wide.ts'), 'declare function external(): number\n' + Array.from({ length: count }, (_, index) =>
      `export function call${index}() { return external() }`).join('\n'))
    await project.refresh({ changes: [{ path: 'wide.ts', kind: 'add' }] })
    const updates = vi.spyOn(IndexedValues.prototype, 'update')
    const snapshot = await project.open()
    const inventory = await snapshot.calls({ paths: ['wide.ts'] })
    expect(inventory.sites).toHaveLength(count)
    const index = updates.mock.results.at(-1)!.value as IndexedValues
    expect(index.work.contributions).toBeLessThan(count * 4)
    await snapshot.dispose()
  })

  it('projects selected calls without decoding whole bodies and follows a helper outside the source filter', async () => {
    const { project } = await fixture()
    const snapshot = await project.open()
    decoded.length = 0
    const inventory = await snapshot.calls({ paths: ['main.ts'] })
    expect(inventory.completeness).toEqual({ kind: 'complete' })
    expect(inventory.sites).toHaveLength(1)
    const evaluator = await snapshot.values()
    expect(decoded).toEqual([])
    const site = inventory.sites[0]!
    const proof = await evaluator.value(site.call.occurrence).property('count').resolve()
    expect(proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 1 } })
    expect(decoded.map((compact) => `symbol:${Buffer.from(compact, 'base64url').toString('hex')}`)).toEqual([site.call.target])
    await snapshot.dispose()
  })

  it('retains global mutation witnesses outside selected paths through incremental and fresh evaluation', async () => {
    const { root, project } = await fixture()
    const initial = await project.open()
    const first = (await initial.calls({ paths: ['main.ts'] })).sites[0]!
    const previous = await initial.values()
    const proof = await previous.value(first.call.occurrence).property('count').resolve()
    expect(proof.kind).toBe('known')
    await writeFile(join(root, 'mutator.ts'), "import { options } from './helper.js'; options.count = 2\n")
    await project.refresh({ changed: ['mutator.ts'] })
    const updated = await project.open()
    decoded.length = 0
    const site = (await updated.calls({ paths: ['main.ts'] })).sites[0]!
    const evaluator = await updated.values()
    expect(evaluator.canReuse(proof)).toBe(false)
    const result = await evaluator.value(site.call.occurrence).property('count').resolve()
    expect(result).toMatchObject({ kind: 'unknown' })
    expect(decoded).toEqual([]) // The unchanged helper was already demanded; the mutator needs only packed effect columns.
    expect(await previous.value(first.call.occurrence).property('count').resolve()).toEqual(proof)
    const independent = await open(root)
    await independent.refresh()
    const fresh = await independent.open()
    const freshSite = (await fresh.calls({ paths: ['main.ts'] })).sites[0]!
    expect(await (await fresh.values()).value(freshSite.call.occurrence).property('count').resolve()).toEqual(result)
    await fresh.dispose(); await updated.dispose(); await initial.dispose()
  })

  it('preserves exact logical rows while decoding individual packed columns', async () => {
    const { project } = await fixture()
    const snapshot = await project.open()
    for await (const fact of snapshot.facts.export('body')) {
      const projection = projectPackedTypeScriptBody(fact)!
      expect(projection).toBeDefined()
      const body = fact.payload.body
      expect(projection.owner).toBe(body.function)
      for (let row = 0; row < body.occurrences.length; row++) {
        const occurrence = body.occurrences[row]!
        expect(projection.occurrence(row)).toEqual(occurrence)
        const children = new Map(body.relations.filter((item) => item.parent === occurrence.id).map((item) => [item.role, item.child]))
        expect([...(projection.children(row) ?? [])]).toEqual([...children])
        expect(projection.parents(row) ?? []).toEqual(body.relations.filter((item) => item.child === occurrence.id).map(({ parent, role }) => ({ parent, role })))
        expect(projection.definitions(row) ?? []).toEqual(body.definitions.filter((item) => item.use === occurrence.id).map((item) => item.definition))
        expect(projection.definite(row)).toBe(body.definitions.some((item) => item.use === occurrence.id && item.reaching === 'definite'))
        expect(projection.value(row)).toEqual(fact.payload.values[occurrence.id])
      }
      expect(projection.calls.map((_, row) => projection.call(row))).toEqual(body.calls)
    }
    await snapshot.dispose()
  })
})

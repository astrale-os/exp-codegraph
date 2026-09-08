import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import { IndexedValues, type IndexedFact } from '../analysis/typescript/value/symbolic/facts.ts'
import { ValueIndexTable } from '../analysis/typescript/value/symbolic/table.ts'
import { createValueEvaluatorFactory } from '../analysis/typescript/value/symbolic/engine.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'

const roots: string[] = []
const projects: TypeScriptProject[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(projects.splice(0).map((project) => project.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const text = (source: number, value = 'before') => Array.from({ length: 8 }, (_, index) =>
  `export function helper${index}(input: string) { const object = {value: input}; return object.value }\nexport const call${index} = helper${index}('${value}-${source}-${index}')`).join('\n')
async function fixture(count = 24) {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-incremental-index-'))
  roots.push(root)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] }))
  await Promise.all(Array.from({ length: count }, (_, source) => writeFile(join(root, `source-${source}.ts`), text(source))))
  const project = await open(root)
  return { root, project }
}
async function open(root: string) {
  const project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.body', 'typescript.symbol', 'typescript.source'],
  })
  projects.push(project)
  return project
}
async function observations(snapshot: TypeScriptProjectSnapshot, path = 'source-0.ts') {
  const calls = await snapshot.calls({ paths: [path] })
  const values = await snapshot.values()
  return { completeness: calls.completeness,
    results: await Promise.all(calls.sites.map((site) => values.value(site.call.occurrence).resolve())),
  }
}

describe('incremental value index ownership', () => {
  it('reuses one generation and indexes only changed shards while matching a fresh project', async () => {
    const { root, project } = await fixture()
    const updates = vi.spyOn(IndexedValues.prototype, 'update')
    const initial = await project.refresh()
    const before = await project.open()
    const old = await observations(before)
    const cold = updates.mock.results.at(-1)!.value as IndexedValues
    expect(old.completeness).toEqual({ kind: 'complete' })
    expect(old.results).toHaveLength(8)
    expect(old.results.every((result) => result.kind === 'known')).toBe(true)
    const same = await project.open(initial.generation)
    const exports = vi.spyOn(same.query, 'export')
    const builds = updates.mock.calls.length
    expect(await observations(same)).toEqual(old)
    expect(exports).not.toHaveBeenCalled()
    expect(updates).toHaveBeenCalledTimes(builds)
    await same.dispose()

    await writeFile(join(root, 'source-0.ts'), text(0, 'edited'))
    const changed = await project.refresh({ changed: ['source-0.ts'] })
    const expectedIds = changed.transactions.flatMap((transaction) => transaction.upserts
      .filter((shard) => ['typescript.body', 'typescript.symbol', 'typescript.source'].includes(shard.namespace))
      .flatMap((shard) => shard.facts.map((fact) => fact.id)))
    const after = await project.open()
    const incrementalExports = vi.spyOn(after.query, 'export')
    const ids = vi.spyOn(after.query, 'factsById')
    const actual = await observations(after)
    const delta = updates.mock.results.at(-1)!.value as IndexedValues
    expect(incrementalExports).not.toHaveBeenCalled()
    expect(ids.mock.calls.flatMap(([values]) => values).sort()).toEqual(expectedIds.sort())
    expect(delta.work.facts).toBeLessThan(cold.work.facts / 8)
    expect(delta.work.bodies).toBeLessThan(cold.work.bodies / 8)
    expect(delta.revision.parent).toBe(cold.revision.token)
    expect(delta.revision.changed.size).toBeGreaterThan(0)
    expect(await observations(before)).toEqual(old)
    expect(actual).not.toEqual(old)

    const fresh = await open(root)
    await fresh.refresh()
    const independentlyBuilt = await fresh.open()
    expect(await observations(independentlyBuilt)).toEqual(actual)
    await independentlyBuilt.dispose(); await after.dispose(); await before.dispose()
  })

  it('compacts undemanded revisions, recovers a failed read and preserves readers across root membership changes', async () => {
    const { root, project } = await fixture(4)
    const initial = await project.refresh()
    const pinned = await project.open()
    const original = await observations(pinned)
    for (const value of ['edit01', 'edit02', 'edit03']) {
      await writeFile(join(root, 'source-0.ts'), text(0, value))
      await project.refresh({ changed: ['source-0.ts'] })
    }
    const latest = await project.open()
    const read = vi.spyOn(latest.query, 'factsById')
    read.mockRejectedValueOnce(new Error('interrupted indexed read'))
    await expect(latest.values()).rejects.toThrow('interrupted indexed read')
    const result = await observations(latest)
    expect(result.results.every((value) => value.kind === 'known' && value.value.kind === 'literal' &&
      String(value.value.value).startsWith('edit03'))).toBe(true)
    expect(await observations(pinned)).toEqual(original)

    await writeFile(join(root, 'added.ts'), 'export const added = 1\n')
    const added = await project.refresh({ changes: [{ path: 'added.ts', kind: 'add' }] })
    expect(added.generation.universe).toBe(initial.generation.universe)
    const expanded = await project.open()
    const expandedResult = await observations(expanded)
    expect(expandedResult.results.map(({ evidence: _evidence, ...value }) => value))
      .toEqual(result.results.map(({ evidence: _evidence, ...value }) => value))
    const proofFacts = [...new Set(expandedResult.results.flatMap((value) => value.evidence))]
    expect((await expanded.query.factsById(proofFacts)).map((fact) => fact.id).sort()).toEqual(proofFacts.sort())
    await rm(join(root, 'added.ts'))
    await project.refresh({ changes: [{ path: 'added.ts', kind: 'unlink' }] })
    const returned = await project.open()
    expect(await observations(returned)).toEqual(result)
    expect(await observations(pinned)).toEqual(original)
    await returned.dispose(); await expanded.dispose(); await latest.dispose(); await pinned.dispose()
  })

  it('recovers a revision whose still-loading predecessor fails without poisoning later reads', async () => {
    const { root, project } = await fixture(1)
    await project.refresh()
    const before = await project.open()
    let fail!: () => void
    const blocked = new Promise<void>((resolve) => { fail = resolve })
    vi.spyOn(before.query, 'export').mockImplementationOnce(async function* () {
      await blocked
      throw new Error('interrupted old snapshot')
    })
    const rejected = expect(before.values()).rejects.toThrow('interrupted old snapshot')
    await writeFile(join(root, 'source-0.ts'), text(0, 'edited'))
    await project.refresh({ changed: ['source-0.ts'] })
    const after = await project.open()
    fail()
    await rejected
    const latest = await observations(after)
    expect(latest.results.every((result) => result.kind === 'known' && result.value.kind === 'literal' &&
      String(result.value.value).startsWith('edited'))).toBe(true)
    const original = await observations(before)
    expect(original.results.every((result) => result.kind === 'known' && result.value.kind === 'literal' &&
      String(result.value.value).startsWith('before'))).toBe(true)
    await after.dispose(); await before.dispose()
  })

  it('invalidates initializer evidence even when a proof stops before visiting its occurrence', async () => {
    const { root, project } = await fixture(1)
    await writeFile(join(root, 'source-0.ts'), "export const outside = 'before'; export function capture() { return outside }\n")
    await project.refresh()
    const snapshot = await project.open()
    const facts: IndexedFact[] = []
    for (const kind of ['body', 'symbol', 'source'] as const) for await (const fact of snapshot.facts.export(kind)) facts.push(fact)
    const outside = facts.find((fact) => fact.namespace === 'typescript.symbol' && fact.payload.name === 'outside')!
    const capture = facts.find((fact) => fact.namespace === 'typescript.symbol' && fact.payload.name === 'capture')!
    if (outside.namespace !== 'typescript.symbol' || capture.namespace !== 'typescript.symbol') throw new Error('Expected symbols.')
    const module = facts.find((fact) => fact.namespace === 'typescript.body' && fact.payload.body.scope === 'module')!
    const body = facts.find((fact) => fact.namespace === 'typescript.body' && fact.payload.body.function === capture.payload.symbol)!
    if (module.namespace !== 'typescript.body' || body.namespace !== 'typescript.body') throw new Error('Expected bodies.')
    const use = body.payload.body.occurrences.find((occurrence) => occurrence.symbol === outside.payload.symbol)!
    const before = IndexedValues.empty().update(facts, [], true)
    const limited = await createValueEvaluatorFactory(snapshot.query, undefined, async () => before)({ limits: { maximumSteps: 1 } })
    const proof = await limited.value(use.id).resolve()
    expect(proof).toMatchObject({ kind: 'unknown', reasons: [expect.objectContaining({ code: 'VALUE_STEP_LIMIT' })] })
    expect(proof.evidence).toContain(module.id)
    const replacement = { ...module, id: deriveAnalysisId('fact', 'index-evidence-replacement', module.id) }
    const after = before.update([replacement], [module.id])
    const next = await createValueEvaluatorFactory(snapshot.query, undefined, async () => after)({ limits: { maximumSteps: 1 } })
    expect(next.canReuse(proof)).toBe(false)
    const updated = await next.value(use.id).resolve()
    expect(updated.evidence).toContain(replacement.id)
    expect(updated.evidence).not.toContain(module.id)
    await snapshot.dispose()
  })

  it('tracks every contributing body when overlapping facts merge object relations', async () => {
    const { root, project } = await fixture(1)
    await writeFile(join(root, 'source-0.ts'), "export const object = { foo: 'present' }\n")
    await project.refresh()
    const snapshot = await project.open()
    const facts: IndexedFact[] = []
    for (const kind of ['body', 'symbol', 'source'] as const) for await (const fact of snapshot.facts.export(kind)) facts.push(fact)
    const body = facts.find((fact) => fact.namespace === 'typescript.body' && fact.payload.body.scope === 'module')!
    if (body.namespace !== 'typescript.body') throw new Error('Expected module body.')
    const object = body.payload.body.occurrences.find((node) => node.syntax === 'ObjectLiteralExpression')!
    const ids = [deriveAnalysisId('fact', 'overlap', 'first'), deriveAnalysisId('fact', 'overlap', 'second')].sort()
    const empty = { ...body.payload, body: { ...body.payload.body,
      relations: body.payload.body.relations.filter((relation) => relation.parent !== object.id),
    } }
    const first = { ...body, id: ids[0]!, payload: empty }
    const selected = { ...body, id: ids[1]!, payload: empty }
    const before = IndexedValues.empty().update([...facts.filter((fact) => fact !== body), first, selected], [], true)
    const evaluator = await createValueEvaluatorFactory(snapshot.query, undefined, async () => before)()
    const proof = await evaluator.value(object.id).property('foo').resolve()
    expect(proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: undefined } })
    expect(proof.evidence).toEqual(expect.arrayContaining(ids))
    const after = before.update([{ ...first, payload: body.payload }], [])
    const updated = await createValueEvaluatorFactory(snapshot.query, undefined, async () => after)()
    expect(after.revision.changed.has(`function:${body.payload.body.function}`)).toBe(true)
    expect(updated.canReuse(proof)).toBe(false)
    expect(await updated.value(object.id).property('foo').resolve()).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'present' } })
    expect(await evaluator.value(object.id).property('foo').resolve()).toEqual(proof)
    await snapshot.dispose()
  })
})

describe('immutable value lookup revisions', () => {
  it('keeps historical tables stable through insertions, deletions, collisions and stored undefined values', () => {
    const initial = new ValueIndexTable<string, number | undefined>()
    const build = initial.edit()
    const oracle = new Map<string, number | undefined>()
    // Equal trailing digest words deliberately share a hash bucket while full keys remain distinct.
    for (let index = 0; index < 4096; index++) {
      const key = index % 5 ? `key-${index}` : `occurrence:${index.toString(16).padStart(56, '0')}deadbeef`
      oracle.set(key, index % 7 ? index : undefined)
      build.set(key, oracle.get(key))
    }
    const pinned = build.finish()
    expect(initial.size).toBe(0)
    const edit = pinned.edit()
    for (const [index, key] of [...oracle.keys()].entries()) {
      if (index % 17 === 0) { edit.delete(key); oracle.delete(key) }
      else if (index % 13 === 0) { edit.set(key, -index); oracle.set(key, -index) }
    }
    const updated = edit.finish()
    expect([...updated].sort()).toEqual([...oracle].sort())
    expect(updated.size).toBe(oracle.size)
    expect(pinned.size).toBe(4096)
    expect(pinned.has('key-7')).toBe(true)
    expect(pinned.get('key-7')).toBeUndefined()
    expect(pinned.get('key-13')).toBe(13)
    expect(updated.get('key-13')).toBe(-13)
    expect(() => edit.set('late', 1)).toThrow('already published')
  })
})

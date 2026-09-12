import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { factShardDigest, validateFactShard } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, createFactWithPhysicalPayload, ownPhysicalPayloadRecord, physicalPayloadForTransport,
} from '../analysis/facts/representation/index.ts'
import { deriveAnalysisId, type FactId } from '../analysis/identity/index.ts'
import { openTypeScriptProject, type TypeScriptProject, type TypeScriptProjectSnapshot } from '../analysis/typescript/index.ts'
import type { TypeScriptFact } from '../analysis/typescript/facts/index.ts'
import { projectPackedTypeScriptBody, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'
import { createValueEvaluatorFactory } from '../analysis/typescript/value/symbolic/engine.ts'
import { IndexedValues, type IndexedFact } from '../analysis/typescript/value/symbolic/facts.ts'
import type { NodeReference } from '../analysis/typescript/value/symbolic/fragment.ts'
import { ValueIndexTableEdit } from '../analysis/typescript/value/symbolic/table.ts'

type Body = TypeScriptFact<'body'>
type RowContribution = NodeReference & { readonly owner: FactId; readonly value: NodeReference }
let root: string, project: TypeScriptProject, snapshot: TypeScriptProjectSnapshot
let facts: IndexedFact[], body: Body
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'codegraph-row-ownership-'))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] }))
  await writeFile(join(root, 'main.ts'), [
    "export const object = { foo: 'present' }",
    'export function helper(value: unknown) { return value }',
    'export const result = helper(object)',
  ].join('\n'))
  project = await openTypeScriptProject({ root,
    ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
    capabilities: ['typescript.body', 'typescript.symbol', 'typescript.source'],
  })
  await project.refresh()
  snapshot = await project.open()
  facts = []
  for (const kind of ['body', 'symbol', 'source'] as const) for await (const fact of snapshot.facts.export(kind)) facts.push(fact)
  body = facts.find((fact): fact is Body => fact.namespace === 'typescript.body' && fact.payload.body.scope === 'module')!
}, 120_000)
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await snapshot?.dispose(); await project?.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})

function replacing(...bodies: Body[]) { return [...facts.filter((fact) => fact !== body), ...bodies] }
function withId(id: FactId): Body {
  const { payload: _, ...fields } = body
  const record = ownPhysicalPayloadRecord(JSON.parse(JSON.stringify(physicalPayloadForTransport(body))))
  const fact = createFactWithPhysicalPayload({ ...fields, id }, record,
    admitFactPayloadCodecs(TYPESCRIPT_FACT_PAYLOAD_CODECS), 'row ownership fixture')
  const shard = { key: deriveAnalysisId('fact-shard', 'row-ownership', id), namespace: fact.namespace,
    schemaVersion: 1, completion: { kind: 'complete' } as const, facts: [fact] }
  expect(validateFactShard({ ...shard, digest: factShardDigest(shard) })).toEqual([])
  expect(projectPackedTypeScriptBody(fact)).toBeDefined()
  return fact as Body
}
function observeSlots() {
  const writes = new Map<string, unknown>()
  const set = ValueIndexTableEdit.prototype.set
  vi.spyOn(ValueIndexTableEdit.prototype, 'set').mockImplementation(function (key, value) {
    writes.set(key, value)
    return Reflect.apply(set, this, [key, value])
  })
  return writes
}
async function property(index: IndexedValues) {
  const object = body.payload.body.occurrences.find((node) => node.syntax === 'ObjectLiteralExpression')!
  return (await createValueEvaluatorFactory(snapshot.query, undefined, async () => index)())
    .value(object.id).property('foo').resolve()
}

describe('private body row ownership', () => {
  it('publishes immutable data contributions while projected values, proofs and transport stay acyclic', async () => {
    const rows: RowContribution[] = []
    const set = ValueIndexTableEdit.prototype.set
    vi.spyOn(ValueIndexTableEdit.prototype, 'set').mockImplementation(function (key, value) {
      if (value && typeof value === 'object' && 'value' in value && value.value === value) rows.push(value as RowContribution)
      return Reflect.apply(set, this, [key, value])
    })
    const wire = () => facts.map((fact) => JSON.stringify(physicalPayloadForTransport(fact) ?? fact))
    const before = wire()
    const index = IndexedValues.empty().update(facts, [], true)
    const bodies = facts.filter((fact): fact is Body => fact.namespace === 'typescript.body')
    expect(rows).toHaveLength(bodies.reduce((count, fact) => count + fact.payload.body.occurrences.length + fact.payload.body.calls.length, 0))
    for (const row of rows) {
      expect(Object.isFrozen(row)).toBe(true)
      expect(Reflect.ownKeys(row).sort()).toEqual(['fragment', 'owner', 'row', 'value'])
      expect(row.owner).toBe(row.fragment.fact.id)
      expect(row.owner).not.toBe(row.fragment.owner)
      expect(Object.getOwnPropertyDescriptor(row, 'value')).toMatchObject({ value: row, writable: false, configurable: false })
      expect(Object.getOwnPropertyDescriptor(row, 'value')!.get).toBeUndefined()
      expect(Reflect.set(row, 'row', row.row + 1)).toBe(false)
      expect(Reflect.set(row, 'owner', 'foreign')).toBe(false)
      expect(Reflect.set(row, 'fragment', undefined)).toBe(false)
      expect(Reflect.set(row, 'value', undefined)).toBe(false)
      expect(Reflect.setPrototypeOf(row, null)).toBe(false)
      expect(Reflect.defineProperty(row, 'value', { get: () => undefined })).toBe(false)
    }
    expect(wire()).toEqual(before)
    expect(() => JSON.stringify([...index.occurrences])).not.toThrow()
    expect(() => JSON.stringify([...index.calls])).not.toThrow()
    const proof = await property(index)
    expect(proof).toMatchObject({ kind: 'known', value: { kind: 'literal', value: 'present' } })
    expect(() => JSON.stringify(proof)).not.toThrow()
  })

  it('retains exact contributions through promotion, removal and reinsertion without changing a pin', async () => {
    const [first, second] = ['first', 'second'].map((name) => withId(deriveAnalysisId('fact', 'row-ownership', name)))
    const writes = observeSlots()
    const id = body.payload.body.occurrences.find((node) => node.syntax === 'ObjectLiteralExpression')!.id
    const key = `occurrence:${id}`
    const initial = IndexedValues.empty().update(replacing(first!), [], true)
    const single = writes.get(id) as RowContribution
    const proof = await property(initial), witness = initial.dependency(key)
    expect(single.value).toBe(single)
    const overlap = initial.update([second!], [])
    const multiple = writes.get(id) as { owners: ReadonlyMap<FactId, RowContribution> }
    expect(multiple.owners.get(first!.id)).toBe(single)
    expect([...multiple.owners.keys()].sort()).toEqual([first!.id, second!.id].sort())
    expect((await property(overlap)).evidence).toEqual(expect.arrayContaining([first!.id, second!.id]))
    const restored = overlap.update([], [second!.id])
    expect(writes.get(id)).toBe(single)
    expect(restored.dependency(key)).toEqual(witness)
    expect(await property(restored)).toEqual(proof)
    expect(await property(initial)).toEqual(proof)
    const removed = restored.update([], [first!.id])
    expect(removed.occurrences.has(id)).toBe(false)
    expect(removed.dependency(key)).toEqual({ key, fingerprint: undefined })
    const reinserted = removed.update([first!], [])
    expect(await property(reinserted)).toEqual(proof)
    expect([...overlap.evidence.get(key)!].sort()).toEqual([first!.id, second!.id].sort())
    expect(removed.occurrences.has(id)).toBe(false)
  })

  it('keeps call membership separate from a logical contributor containing only its occurrence', () => {
    const first = withId(deriveAnalysisId('fact', 'row-ownership', 'packed-call'))
    const logical: Body = { ...body, id: deriveAnalysisId('fact', 'row-ownership', 'logical-no-call'),
      payload: { ...body.payload, body: { ...body.payload.body, calls: [] } } }
    const call = body.payload.body.calls[0]!
    expect(projectPackedTypeScriptBody(logical)).toBeUndefined()
    const initial = IndexedValues.empty().update(replacing(first, logical), [], true)
    expect(initial.calls.get(call.occurrence)).toEqual(call)
    const removed = initial.update([], [first.id])
    expect(removed.occurrences.has(call.occurrence)).toBe(true)
    expect(removed.calls.has(call.occurrence)).toBe(false)
    expect(initial.calls.get(call.occurrence)).toEqual(call)
    expect(removed.update([first], []).calls.get(call.occurrence)).toEqual(call)
  })

  it('discards a failed construction and retries without changing published rows or proofs', async () => {
    const initial = IndexedValues.empty().update(facts, [], true)
    const proof = await property(initial)
    const replacement = withId(deriveAnalysisId('fact', 'row-ownership', 'retry'))
    const freeze = Object.freeze
    let rows = 0
    const failure = vi.spyOn(Object, 'freeze').mockImplementation((value) => {
      if (value && typeof value === 'object' && 'value' in value && value.value === value && ++rows === 3) {
        throw new Error('interrupted row construction')
      }
      return freeze(value)
    })
    try { expect(() => initial.update([replacement], [body.id])).toThrow('interrupted row construction') }
    finally { failure.mockRestore() }
    expect(await property(initial)).toEqual(proof)
    const retry = initial.update([replacement], [body.id])
    const fresh = IndexedValues.empty().update(replacing(replacement), [], true)
    expect(await property(retry)).toEqual(await property(fresh))
    expect(await property(initial)).toEqual(proof)
  })
})

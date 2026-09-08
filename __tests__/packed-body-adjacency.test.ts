import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { factShardDigest, validateFactShard, type Fact } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, bindPhysicalFact, createFactWithPhysicalPayload, ownPhysicalPayloadRecord,
} from '../analysis/facts/representation/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import { openTypeScriptProject } from '../analysis/typescript/index.ts'
import type { FunctionBodyIR } from '../analysis/typescript/body/index.ts'
import { projectPackedTypeScriptBody, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'

const relations = [
  [4, 4, 5], [2, 1, 3], [0, 1, 3], [0, 2, 4], [3, 1, 3],
  [0, 3, 3], [1, 0, 3], [0, 4, 4], [0, 1, 5], [18, 18, 5],
]
const definitions = [
  [0, 2, -1, 7], [2, 2, -1, 6], [0, 2, -1, 7], [1, 2, -1, 6],
  [4, 4, -1, 7], [0, 0, -1, 6], [7, 7, -1, 6], [8, 8, -1, 6],
  [15, 15, -1, 6], [16, 16, -1, 6], [18, 18, -1, 6],
]

function fixture(version: number, edges = relations, uses = definitions, count = 19) {
  const compact = (name: string) => Buffer.from(deriveAnalysisId('occurrence', 'adjacency', name).split(':')[1]!, 'hex').toString('base64url')
  const constants = [compact('source'), compact('revision'), compact('owner')]
  const data = {
    c: version === 1 ? constants : [...constants, 'function', 'sync'],
    s: [], t: ['expression', 'Identifier', 'entry', 'left', 'right', 'self', 'definite', 'possible'], p: [],
    o: Array.from({ length: count }, (_, row) => [compact(`occurrence-${row}`), 0, row, row + 1, 1, -1,
      ...(version >= 3 ? [null] : []), ...(version >= 4 ? [-1] : []), ...(version >= 5 ? [-1, -1, -1] : [])]),
    r: edges, b: [[2, Array.from({ length: count }, (_, row) => row)]], e: [], d: uses, a: [],
    u: [[], [], [], [], [], 0], v: [], q: { kind: 'complete' },
  }
  return version === 6 ? { ...data,
    o: [data.o.map(row => row[0]), data.o.flatMap(row => [row[1], row[2], row[3], row[4], row[5], row[7], row[8], row[9], row[10]]), data.o.map(row => row[6])],
    r: edges.flat(), d: uses.flat(),
  } : data
}

function admit(version: number, data: ReturnType<typeof fixture>, own = true) {
  const input = JSON.parse(JSON.stringify({ codec: `typescript.body.packed/${version}`, data }))
  const record = own ? ownPhysicalPayloadRecord(input) : input
  const fact = createFactWithPhysicalPayload({
    id: deriveAnalysisId('fact', 'adjacency', data), generation: deriveAnalysisId('generation', 'adjacency', 1),
    namespace: 'typescript.body', schemaVersion: 1, kind: 'body', subject: 'adjacency',
    completeness: { kind: 'complete' },
    provenance: { pass: deriveAnalysisId('pass', 'adjacency', 1), passVersion: '1', evidence: [], inputs: [] },
  }, record, admitFactPayloadCodecs(TYPESCRIPT_FACT_PAYLOAD_CODECS), 'adjacency fixture')
  expect(projectPackedTypeScriptBody(fact)).toBeUndefined()
  const shard = { key: deriveAnalysisId('fact-shard', 'adjacency', data), namespace: fact.namespace,
    schemaVersion: 1, completion: { kind: 'complete' } as const, facts: [fact] }
  expect(validateFactShard({ ...shard, digest: factShardDigest(shard) })).toEqual([])
  return fact
}

function compare(fact: Fact) {
  const projection = projectPackedTypeScriptBody(fact)!
  expect(projection).toBeDefined()
  const { body } = fact.payload as { body: FunctionBodyIR }
  const result = []
  for (let row = 0; row < body.occurrences.length; row++) {
    const id = body.occurrences[row]!.id
    const outgoing = body.relations.filter((item) => item.parent === id)
    const incoming = body.relations.filter((item) => item.child === id)
    const reaching = body.definitions.filter((item) => item.use === id)
    const children = projection.children(row), parents = projection.parents(row), definitions = projection.definitions(row)
    expect(children === undefined).toBe(outgoing.length === 0)
    expect(parents === undefined).toBe(incoming.length === 0)
    expect(definitions === undefined).toBe(reaching.length === 0)
    expect([...(children ?? [])]).toEqual([...new Map(outgoing.map(({ role, child }) => [role, child]))])
    expect(parents ?? []).toEqual(incoming.map(({ parent, role }) => ({ parent, role })))
    expect(definitions ?? []).toEqual(reaching.map(({ definition }) => definition))
    expect(projection.definite(row)).toBe(reaching.some(({ reaching }) => reaching === 'definite'))
    result.push({ children: children && [...children], parents, definitions, definite: projection.definite(row) })
  }
  for (const index of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, body.occurrences.length, body.occurrences.length + 10]) {
    expect(projection.children(index)).toBeUndefined()
    expect(projection.parents(index)).toBeUndefined()
    expect(projection.definitions(index)).toBeUndefined()
    expect(projection.definite(index)).toBe(false)
  }
  return result
}

describe('packed body adjacency', () => {
  for (const version of [1, 2, 3, 4, 5, 6]) {
    it(`matches logical adjacency including order, repeated roles and definitions in codec ${version}`, () => {
      for (const reversed of [false, true]) {
        const fact = admit(version, fixture(version, reversed ? [...relations].reverse() : relations,
          reversed ? [...definitions].reverse() : definitions))
        const projection = projectPackedTypeScriptBody(fact)!
        const physical = JSON.stringify(projection.record)
        const expected = compare(fact)
        // A caller may mutate its result without changing another reader or a pin.
        ;(projection.children(0) as Map<unknown, unknown>).clear()
        ;(projection.parents(1) as unknown[]).splice(0)
        ;(projection.definitions(2) as unknown[]).splice(0)
        expect(compare(fact)).toEqual(expected)
        expect(JSON.stringify(projection.record)).toBe(physical)
        const rebound = bindPhysicalFact(fact, deriveAnalysisId('generation', 'adjacency', 2))
        expect(projectPackedTypeScriptBody(rebound)).toBe(projection)
        expect(compare(rebound)).toEqual(expected)
      }
    })

    it(`preserves empty, sparse and wide buckets in codec ${version}`, () => {
      compare(admit(version, fixture(version, [], [], 0)))
      compare(admit(version, fixture(version, [], [], 128)))
      const wide = Array.from({ length: 127 }, (_, row) => [127, row, 3])
      const reverse = Array.from({ length: 127 }, (_, row) => [row, 127, 4])
      const repeated = Array.from({ length: 127 }, (_, row) => [row % 7, 127, -1, row % 2 ? 6 : 7])
      compare(admit(version, fixture(version, [...wide, ...reverse], repeated, 128)))
    })
  }

  it.each([5, 6])('retains admission boundaries and rejects an exact duplicate relation tuple in codec %i', (version) => {
    expect(projectPackedTypeScriptBody(admit(version, fixture(version), false))).toBeUndefined()
    expect(() => admit(version, fixture(version, [...relations, relations[0]!]))).toThrow('BODY_RELATION_DUPLICATE')
    const earlier = admit(version, fixture(version)), expected = compare(earlier)
    const later = admit(version, fixture(version, [...relations].reverse(), [...definitions].reverse()))
    expect(projectPackedTypeScriptBody(later)).not.toBe(projectPackedTypeScriptBody(earlier))
    expect(compare(later)).not.toEqual(expected)
    expect(compare(earlier)).toEqual(expected)
  })

  it.each([5, 6])('reads a wide replaced role in work proportional to the resulting children in codec %i', (version) => {
    const edges = Array.from({ length: 1023 }, (_, child) => [1023, child, 3])
    const fact = admit(version, fixture(version, edges, [], 1024))
    const projection = projectPackedTypeScriptBody(fact)!
    projection.parents(0) // Build adjacency before measuring a requested result.
    const writes = vi.spyOn(Map.prototype, 'set')
    let calls: number
    try {
      const children = projection.children(1023)!
      calls = writes.mock.calls.length
      expect([...children]).toEqual([['left', projection.occurrences[1022]]])
    } finally { writes.mockRestore() }
    expect(calls!).toBe(1)
    expect(projection.parents(0)).toEqual([{ parent: projection.occurrences[1023], role: 'left' }])
  })

  it.each([5, 6])('retries a failed lazy build without publishing half of the adjacency in codec %i', (version) => {
    const fact = admit(version, fixture(version))
    const projection = projectPackedTypeScriptBody(fact)!
    let allocations = 0
    vi.stubGlobal('Uint32Array', new Proxy(Uint32Array, {
      construct(target, argumentsList) {
        if (++allocations === 4) throw new Error('interrupted adjacency allocation')
        return Reflect.construct(target, argumentsList)
      },
    }))
    try { expect(() => projection.children(0)).toThrow('interrupted adjacency allocation') }
    finally { vi.unstubAllGlobals() }
    compare(fact)
  })

  it('matches real native rows while changed bodies and pinned generations retain their own adjacency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-packed-adjacency-'))
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] }))
    await writeFile(join(root, 'stable.ts'), 'export function stable(value: number) { const copy = { value }; return copy.value }\n')
    const source = (value: number) => `import { stable } from './stable.js';
      export function selected(flag: boolean) { let result = ${value}; if (flag) result = stable(result); return result }
      export const output = selected(true)
    `
    await writeFile(join(root, 'main.ts'), source(1))
    const project = await openTypeScriptProject({ root, capabilities: ['typescript.body', 'typescript.symbol', 'typescript.source'],
      ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) })
    const pins = []
    try {
      await project.refresh()
      const initial = await project.open()
      pins.push(initial)
      const facts = []
      for await (const fact of initial.facts.export('body')) facts.push(fact)
      const expected = facts.map(compare)
      expect(facts.some((fact) => fact.payload.body.relations.length > 0)).toBe(true)
      expect(facts.some((fact) => fact.payload.body.definitions.length > 0)).toBe(true)
      for (const value of [2, 3, 4]) {
        await writeFile(join(root, 'main.ts'), source(value))
        await project.refresh({ changed: ['main.ts'] })
        const current = await project.open()
        pins.push(current)
        let shared = 0, replaced = 0
        for await (const fact of current.facts.export('body')) {
          compare(fact)
          if (facts.some((previous) => projectPackedTypeScriptBody(previous) === projectPackedTypeScriptBody(fact))) shared++
          else replaced++
        }
        expect(shared).toBeGreaterThan(0)
        expect(replaced).toBeGreaterThan(0)
        const pinned = []
        for await (const fact of initial.facts.export('body')) pinned.push(compare(fact))
        expect(pinned).toEqual(expected)
      }
    } finally {
      await Promise.all(pins.map((pin) => pin.dispose()))
      await project.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

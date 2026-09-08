import { describe, expect, it, vi } from 'vitest'
import { factShardDigest, validateFactShard } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, createFactWithPhysicalPayload, ownPhysicalPayloadRecord, payloadForStorage,
} from '../analysis/facts/representation/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import type { TypeScriptBodyFacts } from '../analysis/typescript/index.ts'
import {
  projectPackedTypeScriptBody, TYPESCRIPT_BODY_PAYLOAD_CODEC, TYPESCRIPT_FACT_PAYLOAD_CODECS,
} from '../analysis/typescript/physical/index.ts'
import { PackedNumericRows, PackedOccurrenceRows } from '../analysis/typescript/physical/body-rows.ts'

function fixture() {
  const id = (name: string) => Buffer.from(deriveAnalysisId('occurrence', 'columns', name).split(':')[1]!, 'hex').toString('base64url')
  const t: string[] = []
  const text = (value: string) => { let index = t.indexOf(value); if (index < 0) { index = t.length; t.push(value) } return index }
  const origin = { package: '@example/library', file: 'public.ts', path: ['api', 'operation'] }
  const start = 2 ** 32 + 17
  return {
    c: [id('source'), id('revision'), id('owner'), 'function', 'sync'], s: [id('namespace'), id('parameter')], t, p: [1],
    o: [
      [id('member'), text('expression'), start, start + 3, text('PropertyAccessExpression'), 0, origin, -1, text('module-namespace'), text('operation'), 0],
      [id('assignment'), text('assignment'), start + 4, start + 9, text('BinaryExpression'), 1, null, text('EqualsToken'), -1, -1, -1],
      [id('call'), text('call'), start + 10, start + 14, text('CallExpression'), -1, null, -1, -1, -1, -1],
      [id('use'), text('use'), start + 15, Number.MAX_SAFE_INTEGER, text('Identifier'), 1, null, -1, -1, -1, -1],
    ],
    r: [[2, 0, text('callee')], [2, 1, text('argument:0')], [1, 3, text('right')], [0, 3, text('expression')]],
    b: [[text('entry'), [0, 1]], [text('exit'), [2, 3]]], e: [[0, 1, text('fallthrough'), 2]],
    d: [[1, 3, 1, text('definite')], [1, 3, 1, text('possible')]],
    a: [[2, 0, text('signature'), 0, [text('type')], [1], [[1, 1, 0, 0]], [1], 0, origin]],
    u: [[3], [], [0], [1], [2], 0],
    v: [[3, { kind: 'known', value: { nested: ['value', { present: true }] }, evidence: [] }]],
    q: { kind: 'partial', reasons: [{ code: 'QUALIFICATION', message: 'Preserve completeness.', effective: { limit: 1 } }] },
  }
}

function columns(data = fixture()) {
  return { ...data,
    o: [data.o.map(row => row[0]), data.o.flatMap(row => [row[1], row[2], row[3], row[4], row[5], row[7], row[8], row[9], row[10]]), data.o.map(row => row[6])],
    r: data.r.flat(), e: data.e.flat(), d: data.d.flat(),
  }
}

const previous = TYPESCRIPT_FACT_PAYLOAD_CODECS.find(codec => codec.id === 'typescript.body.packed/5')!
const decode = (data: unknown) => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(data) as TypeScriptBodyFacts

function admit(data: unknown, version: number, owned = true) {
  const input = JSON.parse(JSON.stringify({ codec: `typescript.body.packed/${version}`, data }))
  const fact = createFactWithPhysicalPayload({
    id: deriveAnalysisId('fact', 'columns', 1), generation: deriveAnalysisId('generation', 'columns', 1),
    namespace: 'typescript.body', schemaVersion: 1, kind: 'body', subject: 'columns', completeness: { kind: 'complete' },
    provenance: { pass: deriveAnalysisId('pass', 'columns', 1), passVersion: '1', evidence: [], inputs: [] },
  }, owned ? ownPhysicalPayloadRecord(input) : input, admitFactPayloadCodecs(TYPESCRIPT_FACT_PAYLOAD_CODECS), 'columns fixture')
  const shard = { key: deriveAnalysisId('fact-shard', 'columns', 1), namespace: fact.namespace,
    schemaVersion: 1, completion: { kind: 'complete' } as const, facts: [fact] }
  const digest = factShardDigest(shard)
  expect(validateFactShard({ ...shard, digest })).toEqual([])
  return { fact, digest }
}

describe('columnar packed bodies', () => {
  it('preserves complete logical values, provenance, all occurrence fields and safe integers', () => {
    const data = fixture(), compact = columns(data)
    expect(TYPESCRIPT_BODY_PAYLOAD_CODEC.id).toBe('typescript.body.packed/6')
    const logical = previous.decode(data) as TypeScriptBodyFacts
    expect(decode(compact)).toEqual(logical)
    expect(logical.body.occurrences[0]!.span.start).toBe(2 ** 32 + 17)
    expect(logical.body.occurrences[3]!.span.end).toBe(Number.MAX_SAFE_INTEGER)
    const before = admit(data, 5), after = admit(compact, 6)
    expect(after.digest).toBe(before.digest)
    expect(after.fact.payload).toEqual(before.fact.payload)
    expect(payloadForStorage(after.fact)).toEqual(['physical', 'typescript.body.packed/6', compact])
    expect(projectPackedTypeScriptBody(admit(compact, 6, false).fact)).toBeUndefined()
  })

  it('reads admitted projections directly without rebuilding numeric or occurrence rows', () => {
    const { fact } = admit(columns(), 6)
    const numeric = vi.spyOn(PackedNumericRows.prototype, 'row')
    const occurrences = vi.spyOn(PackedOccurrenceRows.prototype, 'row')
    try {
      const projection = projectPackedTypeScriptBody(fact)!
      for (let row = 0; row < projection.occurrences.length; row++) {
        projection.effectNode(row)
        projection.children(row)
        projection.parents(row)
        projection.definitions(row)
        projection.definite(row)
      }
      expect(numeric).not.toHaveBeenCalled()
      expect(occurrences).not.toHaveBeenCalled()
      const node = projection.occurrence(0)
      expect(projection.occurrence(0)).toBe(node)
      expect(occurrences).toHaveBeenCalledTimes(1)
      expect(projection.effectCandidates).toEqual([1])
    } finally { numeric.mockRestore(); occurrences.mockRestore() }
    const projection = projectPackedTypeScriptBody(fact)!
    const logical = fact.payload as TypeScriptBodyFacts
    expect(projection.call(0)).toEqual(logical.body.calls[0])
    expect(projection.value(3)).toEqual(logical.values[projection.occurrences[3]!])
  })

  it('decodes using bounded scratch rows without retaining them in logical values', () => {
    const data = columns(), before = JSON.stringify(data)
    const numericRows = new Set<unknown>(), occurrenceRows = new Set<unknown>()
    const numeric = PackedNumericRows.prototype.row, occurrence = PackedOccurrenceRows.prototype.row
    const a = vi.spyOn(PackedNumericRows.prototype, 'row').mockImplementation(function(index, scratch) {
      const row = numeric.call(this, index, scratch); numericRows.add(row); return row
    })
    const b = vi.spyOn(PackedOccurrenceRows.prototype, 'row').mockImplementation(function(index, scratch) {
      const row = occurrence.call(this, index, scratch); occurrenceRows.add(row); return row
    })
    let logical: TypeScriptBodyFacts
    try { logical = decode(data) } finally { a.mockRestore(); b.mockRestore() }
    expect(numericRows.size).toBe(1)
    expect(occurrenceRows.size).toBe(1)
    expect([...numericRows][0]).toBe([...occurrenceRows][0])
    expect(JSON.stringify(data)).toBe(before)
    ;(data.o[2]![0] as { path: string[] }).path[0] = 'changed'
    expect(logical!.body.occurrences[0]!.symbolOrigin!.path).toEqual(['api', 'operation'])
    expect(logical!).toEqual(previous.decode(fixture()))
  })

  it('rejects malformed widths, counts, numeric fields, ordinals and identities before publication', () => {
    const mutations: ((data: ReturnType<typeof columns>) => void)[] = [
      data => { data.o.pop() }, data => { data.o[0]!.pop() }, data => { data.o[1]!.pop() }, data => { data.o[2]!.pop() },
      data => { data.r.pop() }, data => { data.e.pop() }, data => { data.d.pop() },
      data => { data.o[1]![1] = Number.MAX_SAFE_INTEGER + 1 }, data => { data.o[1]![1] = 0.5 },
      data => { data.o[1]![4] = 999 }, data => { data.o[1]![5] = -2 },
      data => { data.o[0]![1] = data.o[0]![0]! }, data => { data.r[0] = 999 },
      data => { data.e[0] = -1 }, data => { data.d[2] = 999 },
    ]
    for (const mutate of mutations) {
      const data = columns(); mutate(data)
      expect(() => decode(data)).toThrow()
      expect(() => admit(data, 6)).toThrow()
    }
    expect(decode(columns())).toEqual(previous.decode(fixture()))
  })
})

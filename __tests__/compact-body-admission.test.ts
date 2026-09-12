import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { factHeader, factShardDigest, validateFactShard, type Fact } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, admittedFactShardPayloadBytes, createFactWithPhysicalPayload,
  ownFactPayloadIdentity, ownPhysicalPayloadRecord, ownWireFactShard, physicalPayloadForProjection, physicalPayloadForTransport,
  type FactPayloadCodec,
} from '../analysis/facts/representation/index.ts'
import { admitAnalysisId, deriveAnalysisId } from '../analysis/identity/index.ts'
import { stableJson } from '../analysis/identity/model.ts'
import { openTypeScriptProject, type TypeScriptBodyFacts } from '../analysis/typescript/index.ts'
import { preparePackedBodyIdentity } from '../analysis/typescript/physical/body-admission.ts'
import { TYPESCRIPT_BODY_PAYLOAD_CODEC, TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'

const complete = { kind: 'complete' } as const
const compact = (name: string) => Buffer.from(deriveAnalysisId('occurrence', 'compact-admission', name).split(':')[1]!, 'hex').toString('base64url')
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value))
type Packed = {
  c: unknown[]; s: string[]; t: string[]; p: unknown[]; o: unknown[][];
  r: unknown[]; b: unknown[][]; e: unknown[]; d: unknown[]; a: unknown[][];
  u: unknown[]; v: unknown[][]; q: unknown;
}

function fixture(): Packed {
  const texts: string[] = []
  const text = (value: string) => {
    const previous = texts.indexOf(value)
    return previous < 0 ? texts.push(value) - 1 : previous
  }
  const origin = { package: '@example/commands', file: 'commands.ts', path: ['commands', 'update'] }
  const start = 2 ** 32 + 17
  const rows = [
    [compact('member'), text('expression'), start, start + 3, text('PropertyAccessExpression'), 0, origin, -1, text('module-namespace'), text('update'), 0],
    [compact('assignment'), text('assignment'), start + 4, start + 9, text('BinaryExpression'), 1, null, text('EqualsToken'), -1, -1, -1],
    [compact('call'), text('call'), start + 10, start + 14, text('CallExpression'), -1, null, -1, -1, -1, -1],
    [compact('use'), text('use'), start + 15, Number.MAX_SAFE_INTEGER, text('Identifier'), 1, null, -1, -1, -1, -1],
  ]
  return {
    c: [compact('source'), compact('revision'), compact('owner'), 'function', 'async-generator'],
    s: [compact('namespace'), compact('parameter')], t: texts, p: [1],
    o: [rows.map(row => row[0]), rows.flatMap(row => [row[1], row[2], row[3], row[4], row[5], row[7], row[8], row[9], row[10]]), rows.map(row => row[6])],
    r: [2, 0, text('callee'), 2, 1, text('argument:0'), 1, 3, text('right'), 0, 3, text('expression')],
    b: [[text('entry'), [0, 1]], [text('exit'), [2, 3]]],
    e: [0, 1, text('fallthrough'), 2], d: [1, 3, 1, text('definite'), 1, 3, -1, text('possible')],
    a: [[2, 0, text('signature'), 0, [text('type')], [1], [[1, 1, 0, 1]], [1], 0, origin]],
    u: [[3], [], [0], [2], [1], 1],
    v: [
      [0, { kind: 'known', value: Object.fromEntries([['10', 'ten'], ['2', 'two'], ['__proto__', ['é😀\u2028', '\\u2028', '\uD800']], ['𐀀', true], ['\uE000', false]]), evidence: [] }],
      [1, { kind: 'unknown', reasons: [{ code: 'EXTERNAL', message: 'Unavailable input.', retryable: true, attributableTo: deriveAnalysisId('pass', 'compact-admission', 1) }], evidence: [] }],
      [2, { kind: 'ambiguous', values: ['left', { nested: null }], reasons: [{ code: 'BRANCH', message: 'Both branches.', effective: { count: 2, mode: 'both', exact: true } }], evidence: [] }],
      [3, { kind: 'unsupported', construct: 'external state', evidence: [deriveAnalysisId('fact', 'compact-admission', 'evidence')] }],
    ],
    q: { kind: 'partial', reasons: [{ code: 'QUALIFICATION', message: 'Preserve uncertainty.', effective: { limit: 1 } }] },
  }
}

function rendered(data: unknown) {
  const parts: string[] = []
  let bytes = 0
  preparePackedBodyIdentity(data).write({
    part(ascii) { parts.push(ascii); bytes += Buffer.byteLength(ascii) },
    value(value) { parts.push(stableJson(value)); bytes += Buffer.byteLength(JSON.stringify(value)) },
  })
  return { canonical: parts.join(''), bytes }
}

function fields(index = 1): Omit<Fact, 'payload'> {
  return {
    id: admitAnalysisId('fact', `fact:${index.toString(16).padStart(64, '0')}`),
    generation: deriveAnalysisId('generation', 'compact-admission', 'pending'),
    namespace: 'typescript.body', schemaVersion: 1, kind: 'function-body', subject: `symbol:${'03'.repeat(32)}`,
    completeness: complete, provenance: { pass: deriveAnalysisId('pass', 'compact-admission', 1), passVersion: '1', evidence: [], inputs: [] },
  }
}

function envelope(facts: readonly Fact[]) {
  return { key: deriveAnalysisId('fact-shard-key', 'compact-admission', 1), namespace: 'typescript.body',
    schemaVersion: 1, completion: complete, facts }
}

function physical(data: unknown, codec = TYPESCRIPT_BODY_PAYLOAD_CODEC, owned = true, index = 1) {
  const record = { codec: codec.id, data }
  return createFactWithPhysicalPayload(fields(index), owned ? ownPhysicalPayloadRecord(record) : record,
    admitFactPayloadCodecs([codec]), 'compact admission fixture')
}

function errorOf(action: () => unknown) {
  try { action() } catch (error) {
    if (error instanceof Error) return { name: error.name, message: error.message }
    throw error
  }
  throw new Error('Expected rejection of the malformed fixture.')
}

describe('compact body admission', () => {
  it('preserves the full decoder preimage, logical bytes, optional fields and safe integers', () => {
    const data = fixture(), before = JSON.stringify(data)
    const logical = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(data) as TypeScriptBodyFacts
    expect(rendered(data)).toEqual({ canonical: stableJson(logical), bytes: Buffer.byteLength(JSON.stringify(logical)) })
    expect(JSON.stringify(data)).toBe(before)
    expect(logical.body.occurrences[0]!.span.start).toBe(2 ** 32 + 17)
    expect(logical.body.occurrences[3]!.span.end).toBe(Number.MAX_SAFE_INTEGER)
    expect(logical.body.occurrences[2]).not.toHaveProperty('symbol')
    expect(logical.body.definitions[1]).not.toHaveProperty('symbol')
    expect(logical.body.calls[0]).toMatchObject({ dynamic: false, bindings: [{ rest: true }] })
  })

  it('retains omissions and accepted empty or repeated structures without tightening the IR contract', () => {
    const empty: Packed = { c: [compact('source'), compact('revision'), compact('owner'), 'module', ''],
      s: [], t: [], p: [], o: [[], [], []], r: [], b: [], e: [], d: [], a: [], u: [[], [], [], [], [], 0], v: [], q: complete }
    const permissive = fixture()
    permissive.c[4] = ''
    permissive.p.push(1)
    permissive.e.push(...permissive.e)
    permissive.a[0] = [2, -1, -1, -1, [], [1, 1], [[1, -1, 7, 0]], [], 1, null]
    for (const data of [empty, permissive]) {
      const logical = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(data) as TypeScriptBodyFacts
      expect(logical.body).not.toHaveProperty('execution')
      expect(rendered(data)).toEqual({ canonical: stableJson(logical), bytes: Buffer.byteLength(JSON.stringify(logical)) })
    }
  })

  it('creates its own decoded and scratch fields without invoking inherited setters', () => {
    const data = fixture()
    const logical = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(data)
    const identity = { canonical: stableJson(logical), bytes: Buffer.byteLength(JSON.stringify(logical)) }
    const descriptors = new Map(['id', 'parent', 'from', 'definition', 'start'].map(key =>
      [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const))
    let setterCalls = 0, failure: unknown, decoded: unknown, prepared: ReturnType<typeof rendered> | undefined
    try {
      for (const key of descriptors.keys()) Object.defineProperty(Object.prototype, key, {
        configurable: true, set() { setterCalls++ },
      })
      decoded = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(data)
      prepared = rendered(data)
    } catch (error) { failure = error }
    finally {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(Object.prototype, key, descriptor)
        else Reflect.deleteProperty(Object.prototype, key)
      }
    }
    expect(failure).toBeUndefined()
    expect(setterCalls).toBe(0)
    expect(decoded).toEqual(logical)
    expect(prepared).toEqual(identity)
  })

  const malformed: readonly [string, (data: Packed) => void, string][] = [
    ['exact envelope', data => { Object.assign(data, { extra: true }) }, 'body payload fields'],
    ['constants order', data => { data.c[3] = 'invalid'; data.c[0] = 'bad' }, 'body scope'],
    ['canonical identity', data => { data.c[0] = 'A'.repeat(42) + 'B' }, 'source identity is not canonical'],
    ['dictionary uniqueness', data => { data.s.push(data.s[0]!) }, 'symbols are duplicated'],
    ['occurrence column count', data => { data.o.pop() }, 'exactly three entries'],
    ['occurrence row counts', data => { data.o[1]!.pop() }, 'different row counts'],
    ['optional cells precede ID', data => { data.o[0]![0] = 'bad'; data.o[1]![4] = 99 }, 'occurrences[0].symbol'],
    ['optional ordinal sentinel', data => { data.o[1]![5] = -2 }, 'occurrences[0].operator'],
    ['integer coordinate', data => { data.o[1]![1] = 0.5 }, 'occurrences[0].start'],
    ['safe coordinate', data => { data.o[1]![2] = Number.MAX_SAFE_INTEGER + 1 }, 'occurrences[0].end'],
    ['duplicate occurrence IDs', data => { data.o[0]![1] = data.o[0]![0] }, 'occurrence identities are duplicated'],
    ['relation width', data => { data.r.pop() }, 'relations has an incomplete row'],
    ['relation reference', data => { data.r[0] = 99 }, 'relations[0].parent'],
    ['block identity uniqueness', data => { data.b[1]![0] = data.b[0]![0] }, 'block identities are duplicated'],
    ['edge optional cell first', data => { data.e[0] = 99; data.e[3] = -2 }, 'edges[0].evidence'],
    ['definition optional cell first', data => { data.d[0] = 99; data.d[2] = -2 }, 'definitions[0].symbol'],
    ['call optional cell first', data => { data.a[0]![0] = 99; data.a[0]![1] = -2 }, 'calls[0].target'],
    ['call origin shape', data => { data.a[0]![9] = { package: 'x', file: 'x', path: [] } }, 'symbol origin is invalid'],
    ['binding optional cell first', data => { data.a[0]![6] = [[99, -2, -1, 2]] }, 'bindings[0].parameter'],
    ['call bit', data => { data.a[0]![8] = 2 }, 'calls[0].dynamic must be 0 or 1'],
    ['summary reference before bit', data => { data.u[0] = [99]; data.u[5] = 2 }, 'summary.returns[0]'],
    ['occurrence kind semantics', data => { data.o[1]![0] = data.t.push('invalid-kind') - 1 }, 'BODY_OCCURRENCE_KIND_INVALID'],
    ['symbol origin needs a symbol', data => { data.o[1]![4] = -1; data.o[1]![6] = -1 }, 'BODY_OCCURRENCE_SYMBOL_ORIGIN_INVALID'],
    ['namespace kind needs a symbol', data => { data.o[1]![4] = -1; data.o[2]![0] = null }, 'BODY_SYMBOL_KIND_INVALID'],
    ['property metadata needs matching syntax', data => { data.o[1]![3] = data.t.indexOf('Identifier') }, 'BODY_PROPERTY_NAMESPACE_INVALID'],
    ['empty operator', data => { data.o[1]![5] = data.t.push('') - 1 }, 'BODY_OCCURRENCE_OPERATOR_INVALID'],
    ['unassigned occurrence', data => { data.b[0]![1] = [1] }, 'BODY_OCCURRENCE_UNASSIGNED:'],
    ['edge kind semantics', data => { data.e[2] = data.t.push('invalid-edge') - 1 }, 'BODY_EDGE_KIND_INVALID'],
    ['definition semantics', data => { data.d[3] = data.t.push('invalid-reaching') - 1 }, 'BODY_DEFINITION_REACHING_INVALID'],
    ['call origin needs target', data => { data.a[0]![1] = -1 }, 'BODY_CALL_TARGET_ORIGIN_INVALID'],
    ['call type semantics', data => { data.a[0]![4] = [data.t.push('') - 1] }, 'BODY_CALL_TYPE_INVALID'],
    ['value occurrence uniqueness', data => { data.v.push(clone(data.v[0]!)) }, 'repeats a value occurrence'],
    ['value evidence before kind', data => { data.v[0]![1] = { kind: 'invalid', evidence: ['bad'] } }, 'values[0].value.evidence'],
    ['known value required', data => { data.v[0]![1] = { kind: 'known', evidence: [] } }, 'values[0].value fields'],
    ['value error before completeness', data => { data.v[0]![1] = null; data.q = null }, 'values[0].value must be an object'],
    ['completeness failure identity', data => { data.q = { kind: 'unavailable', reasons: [{ code: 'X', message: 'X', retryable: false, attributableTo: 'bad' }] } }, 'completeness.reasons[0] is invalid'],
  ]
  it.each(malformed)('matches the existing decoder rejection for %s', (_name, mutate, fragment) => {
    const data = fixture(); mutate(data)
    const expected = errorOf(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(clone(data)))
    expect(expected).toMatchObject({ name: 'TypeError', message: expect.stringContaining(fragment) })
    expect(errorOf(() => preparePackedBodyIdentity(clone(data)))).toEqual(expected)
    const fact = physical(clone(data))
    const shard = ownWireFactShard({ ...envelope([fact]), digest: deriveAnalysisId('fact-shard-digest', 'compact-admission', 'invalid') })
    expect(errorOf(() => validateFactShard(shard))).toEqual(expected)
    expect(admittedFactShardPayloadBytes(shard)).toBeUndefined()
    expect(physicalPayloadForProjection(fact, TYPESCRIPT_BODY_PAYLOAD_CODEC)).toBeUndefined()
  })

  it('aggregates and sorts semantic diagnostics before inspecting values or completeness', () => {
    const data = fixture()
    data.c[3] = 'module'
    data.o[1]![2] = data.o[1]![1]
    data.b[0]![1] = [0, 0, 1]
    data.r.push(...data.r.slice(0, 3))
    data.v[0]![1] = null
    data.q = null
    const expected = errorOf(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(clone(data)))
    for (const diagnostic of ['BODY_MODULE_EXECUTION_INVALID', 'BODY_MODULE_FUNCTION_STATE', 'BODY_OCCURRENCE_SPAN_INVALID', 'BODY_OCCURRENCE_MULTIPLE_BLOCKS:', 'BODY_RELATION_DUPLICATE']) {
      expect(expected.message).toContain(diagnostic)
    }
    expect(expected.message).not.toContain('values[')
    expect(errorOf(() => preparePackedBodyIdentity(clone(data)))).toEqual(expected)
  })

  it('reserves direct admission for exact owned codecs and keeps custom decoder observations', () => {
    const data = fixture(), logical = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(clone(data))
    const expected = factShardDigest(envelope([{ ...fields(), payload: logical }]))
    for (const owned of [false, true]) {
      const decode = vi.fn((input: unknown) => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(input))
      const custom: FactPayloadCodec = { id: TYPESCRIPT_BODY_PAYLOAD_CODEC.id, decode }
      for (const codec of [TYPESCRIPT_BODY_PAYLOAD_CODEC, custom]) {
        const fact = physical(clone(data), codec, owned)
        const shard = ownWireFactShard({ ...envelope([fact]), digest: expected })
        expect(validateFactShard(shard)).toEqual([])
        expect(admittedFactShardPayloadBytes(shard)).toBe(Buffer.byteLength(JSON.stringify(logical)))
        if (codec === custom) expect(decode).toHaveBeenCalledTimes(1)
        if (!owned || codec === custom) expect(physicalPayloadForProjection(fact, TYPESCRIPT_BODY_PAYLOAD_CODEC)).toBeUndefined()
        expect(fact.payload).toEqual(logical)
      }
    }
  })

  it('validates all compact facts before emitting identity or certifying an earlier fact', () => {
    const data = fixture(), invalid = clone(data)
    invalid.q = null
    const facts = [physical(clone(data)), physical(invalid, TYPESCRIPT_BODY_PAYLOAD_CODEC, true, 2)]
    const expected = errorOf(() => TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(clone(invalid)))
    const shard = ownWireFactShard({ ...envelope(facts), digest: deriveAnalysisId('fact-shard-digest', 'compact-admission', 'invalid') })
    expect(errorOf(() => validateFactShard(shard))).toEqual(expected)
    expect(admittedFactShardPayloadBytes(shard)).toBeUndefined()
    expect(physicalPayloadForProjection(facts[0]!, TYPESCRIPT_BODY_PAYLOAD_CODEC)).toBeUndefined()
    const repaired = ownWireFactShard({ ...envelope([facts[0]!]), digest: factShardDigest(envelope([{ ...fields(), payload: TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(clone(data)) }])) })
    expect(validateFactShard(repaired)).toEqual([])
    expect(physicalPayloadForProjection(facts[0]!, TYPESCRIPT_BODY_PAYLOAD_CODEC)).toBeDefined()
  })

  it('prepares the whole shard before writing and leaves public decoding lazy', () => {
    const observed: string[] = []
    const codec = ownFactPayloadIdentity({ id: 'qualification.compact-order/1', decode(data) {
      observed.push(`decode:${data}`); return { value: data }
    } }, data => {
      observed.push(`prepare:${data}`)
      return { write(writer) {
        observed.push(`write:${data}`)
        writer.part('{"value":'); writer.value(data); writer.part('}')
      } }
    })
    const facts = ['first', 'second'].map((data, index) => physical(data, codec, true, index + 1))
    const logical = envelope(['first', 'second'].map((value, index) => ({ ...fields(index + 1), payload: { value } })))
    const shard = ownWireFactShard({ ...envelope(facts), digest: factShardDigest(logical) })
    expect(validateFactShard(shard)).toEqual([])
    expect(observed).toEqual(['prepare:first', 'prepare:second', 'write:first', 'write:second'])
    expect(admittedFactShardPayloadBytes(shard)).toBe(Buffer.byteLength('{"value":"first"}{"value":"second"}'))
    expect(facts[0]!.payload).toEqual({ value: 'first' })
    expect(facts[0]!.payload).toBe(facts[0]!.payload)
    expect(observed).toEqual(['prepare:first', 'prepare:second', 'write:first', 'write:second', 'decode:first'])
  })

  it('checks all eligibility conditions before invoking any preparer', () => {
    const previous = TYPESCRIPT_FACT_PAYLOAD_CODECS.find(codec => codec.id === 'typescript.body.packed/5')!
    const oldBody = { c: [compact('source'), compact('revision'), compact('owner'), 'function', ''], s: [], t: [], p: [],
      o: [], r: [], b: [], e: [], d: [], a: [], u: [[], [], [], [], [], 0], v: [], q: complete }
    for (const kind of ['semantic sibling', 'old codec sibling', 'custom sibling', 'unowned record', 'unowned shard', 'decoded payload']) {
      const observed: string[] = []
      const codec = ownFactPayloadIdentity({ id: 'qualification.compact-eligibility/1', decode(data) {
        observed.push('decode'); return { value: data }
      } }, () => { observed.push('prepare'); throw new Error('Ineligible shard reached its preparer.') })
      const first = physical('first', codec, kind !== 'unowned record')
      const facts: Fact[] = [first]
      const logical: Fact[] = [{ ...fields(), payload: { value: 'first' } }]
      if (kind === 'semantic sibling') {
        facts.push({ ...fields(2), payload: 'semantic' }); logical.push(facts[1]!)
      } else if (kind === 'old codec sibling') {
        facts.push(physical(clone(oldBody), previous, true, 2))
        logical.push({ ...fields(2), payload: previous.decode(clone(oldBody)) })
      } else if (kind === 'custom sibling') {
        const custom = { id: codec.id, decode: () => 'custom' }
        facts.push(physical('custom', custom, true, 2)); logical.push({ ...fields(2), payload: 'custom' })
      } else if (kind === 'decoded payload') {
        expect(first.payload).toEqual({ value: 'first' }); observed.length = 0
      }
      const draft = { ...envelope(facts), digest: factShardDigest(envelope(logical)) }
      const shard = kind === 'unowned shard' ? draft : ownWireFactShard(draft)
      expect(validateFactShard(shard)).toEqual([])
      expect(observed, kind).toEqual(kind === 'decoded payload' ? [] : ['decode'])
    }
  })

  it('retains a memoized decoder failure without preparing or retrying it', () => {
    const failure = new TypeError('decoder failure retained by the physical fact')
    const decode = vi.fn(() => { throw failure })
    const prepare = vi.fn(() => { throw new Error('Failed physical state was prepared.') })
    const codec = ownFactPayloadIdentity({ id: 'qualification.compact-failure/1', decode }, prepare)
    const fact = physical('token', codec)
    expect(() => fact.payload).toThrow(failure)
    const shard = ownWireFactShard({ ...envelope([fact]), digest: deriveAnalysisId('fact-shard-digest', 'compact-admission', 'invalid') })
    expect(() => validateFactShard(shard)).toThrow(failure)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(prepare).not.toHaveBeenCalled()
    expect(admittedFactShardPayloadBytes(shard)).toBeUndefined()
  })

  it('checks canonical array intrinsics before invoking any preparer', () => {
    const prepare = vi.fn(() => { throw new Error('Customized arrays reached compact preparation.') })
    const decode = vi.fn(() => ['value'])
    const codec = ownFactPayloadIdentity({ id: 'qualification.compact-intrinsics/1', decode }, prepare)
    const logical = envelope([{ ...fields(), payload: ['value'] }])
    const shard = ownWireFactShard({ ...envelope([physical('token', codec)]), digest: factShardDigest(logical) })
    const previous = Object.getOwnPropertyDescriptor(Array, Symbol.species)!
    let diagnostics: readonly string[] | undefined
    try {
      // Same observable array output, but a customized intrinsic must select the
      // established generic path before a compact codec can do any work.
      Object.defineProperty(Array, Symbol.species, { configurable: true, get: () => Array })
      diagnostics = validateFactShard(shard)
    } finally { Object.defineProperty(Array, Symbol.species, previous) }
    expect(diagnostics).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('falls back after non-JSON emission without changing budget errors or certification', () => {
    const observed: string[] = []
    const codec = ownFactPayloadIdentity({ id: 'qualification.compact-non-json/1', decode() {
      observed.push('decode'); return 42n
    } }, () => {
      observed.push('prepare')
      return { write(writer) { observed.push('write'); writer.value(42n) } }
    })
    const logical = envelope([{ ...fields(), payload: 42n }])
    const digest = factShardDigest(logical)
    const shard = ownWireFactShard({ ...envelope([physical('token', codec)]), digest })
    expect(() => validateFactShard(shard)).toThrow(TypeError)
    expect(observed).toEqual(['prepare', 'write', 'decode'])
    expect(admittedFactShardPayloadBytes(shard)).toBeUndefined()
    observed.length = 0
    const invalid = ownWireFactShard({ ...envelope([physical('token', codec)]), digest: deriveAnalysisId('fact-shard-digest', 'compact-admission', 'invalid') })
    expect(validateFactShard(invalid)).toEqual([expect.stringContaining('FACT_SHARD_DIGEST_MISMATCH')])
    expect(observed).toEqual(['prepare', 'write', 'decode'])
    expect(admittedFactShardPayloadBytes(invalid)).toBeUndefined()
  })

  it('matches complete payloads and shard identities produced by the native analyzer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-compact-admission-'))
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, strict: true }, include: ['*.ts'] }))
    await writeFile(join(root, 'commands.ts'), "export const commands = { update: (id: string, value: unknown) => ({ id, value }) }\n")
    await writeFile(join(root, 'main.ts'), [
      "import * as api from './commands'",
      "export function updateEmployee(id: string, enabled: boolean) {",
      "  const value = { id, state: enabled ? 'active' : 'paused' };",
      "  return api.commands.update(id, value)",
      "}",
      "export const initial = updateEmployee('employee-1', true)",
    ].join('\n'))
    let project: Awaited<ReturnType<typeof openTypeScriptProject>> | undefined
    try {
      project = await openTypeScriptProject({ root,
        ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}),
        capabilities: ['typescript.body', 'typescript.symbol', 'typescript.source'],
      })
      await project.refresh()
      const snapshot = await project.open()
      try {
        let bodies = 0
        for await (const fact of snapshot.facts.export('body')) {
          const record = physicalPayloadForTransport(fact)!
          expect(record.codec).toBe('typescript.body.packed/6')
          const logical = TYPESCRIPT_BODY_PAYLOAD_CODEC.decode(record.data)
          expect(rendered(record.data)).toEqual({ canonical: stableJson(logical), bytes: Buffer.byteLength(JSON.stringify(logical)) })
          expect(factShardDigest(envelope([fact]))).toBe(factShardDigest(envelope([{ ...factHeader(fact), payload: logical }])))
          bodies++
        }
        expect(bodies).toBeGreaterThan(2)
      } finally { await snapshot.dispose() }
    } finally { await project?.dispose(); await rm(root, { recursive: true, force: true }) }
  }, 120_000)
})

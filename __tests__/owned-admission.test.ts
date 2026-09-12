import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { factHeader, factShardDigest, shardReference, validateFactShard, type Fact } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, admittedFactShardPayloadBytes, bindPhysicalFact, createFactWithPhysicalPayload,
  ownFactPayloadCodec, ownPhysicalPayloadRecord, ownWireFactShard, physicalPayloadForProjection, physicalPayloadForTransport,
} from '../analysis/facts/representation/index.ts'
import { generationIdentity, type FactTransaction } from '../analysis/generation/index.ts'
import { admitAnalysisId, deriveAnalysisId } from '../analysis/identity/index.ts'
import { stableJson } from '../analysis/identity/model.ts'
import { createMemoryAnalysisStore } from '../analysis/memory/index.ts'
import { createProcessNativeAnalysisSessionFactory } from '../analysis/protocol/index.ts'
import { TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../analysis/typescript/physical/index.ts'

const complete = { kind: 'complete' } as const
const compact = (byte: number) => Buffer.alloc(32, byte).toString('base64url')
const id = <Kind extends string>(kind: Kind, value: unknown) => deriveAnalysisId(kind, 'owned-admission-test', value)
const fields = (index = 1): Omit<Fact, 'payload'> => ({
  id: admitAnalysisId('fact', `fact:${index.toString(16).padStart(64, '0')}`),
  generation: id('generation', 'pending'), namespace: 'typescript.body', schemaVersion: 1,
  kind: 'function-body', subject: `symbol:${'03'.repeat(32)}`, completeness: complete,
  provenance: { pass: id('pass', 'producer'), passVersion: '1', inputs: [], evidence: [] },
})
function envelope(facts: readonly Fact[], capabilities = true) {
  return { key: id('fact-shard-key', 'body'), namespace: 'typescript.body', schemaVersion: 1,
    completion: complete, ...(capabilities ? { capabilities: ['typescript.body'] } : {}), facts }
}

function packed(version: number, value: unknown) {
  const row = [compact(4), 0, 0, 1, 1, -1, null, -1, -1, -1, -1]
    .slice(0, version >= 5 ? 11 : version >= 4 ? 8 : version >= 3 ? 7 : 6)
  return {
    c: [compact(1), compact(2), compact(3), 'function', 'sync'].slice(0, version === 1 ? 3 : 5),
    s: [], t: ['statement', 'ExpressionStatement', 'entry'], p: [],
    o: version === 6 ? [[row[0]], [row[1], row[2], row[3], row[4], row[5], row[7], row[8], row[9], row[10]], [row[6]]] : [row],
    r: [], b: [[2, [0]]], e: [], d: [], a: [], u: [[], [], [], [], [], 0],
    v: [[0, { kind: 'known', value, evidence: [] }]], q: complete,
  }
}

function bodyShard(value: unknown, version = 6, index = 1, capabilities = true) {
  const codec = TYPESCRIPT_FACT_PAYLOAD_CODECS.find(entry => entry.id === `typescript.body.packed/${version}`)!
  const record = ownPhysicalPayloadRecord(JSON.parse(JSON.stringify({ codec: codec.id, data: packed(version, value) })))
  const fact = createFactWithPhysicalPayload(fields(index), record, admitFactPayloadCodecs([codec]), 'admission fixture')
  const payload = codec.decode(record.data)
  const logical = envelope([{ ...fields(index), payload }], capabilities)
  // Keep the existing whole-value canonicalizer as the independent oracle.
  const digest = factShardDigest(logical)
  const shard = ownWireFactShard({ ...envelope([fact], capabilities), digest })
  return { codec, fact, payload, shard, bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8') }
}

function unusualJSON() {
  return JSON.parse(JSON.stringify(Object.fromEntries([
    ['𐀀', 'astral'], ['\uE000', 'private'], ['\uD800', 'unpaired'],
    ['10', 'ten'], ['2', 'two'], ['4294967294', true], ['4294967295', false], ['00', null],
    ['__proto__', { nested: ['é😀\u2028\u2029', String.raw`\u2028\u2029`, '<>&\\"\n\t'] }],
    ['constructor', 'own data'], ['long', 'é😀\u2028\u2029'.repeat(5_000)],
  ])))
}

describe('owned shard admission', () => {
  it('admits owned semantic JSON without a physical codec against the same byte oracle', () => {
    const payload = unusualJSON()
    const draft = envelope([{ ...fields(), payload }])
    const shard = ownWireFactShard({ ...draft, digest: factShardDigest(draft) })
    expect(validateFactShard(shard)).toEqual([])
    expect(admittedFactShardPayloadBytes(shard)).toBe(Buffer.byteLength(JSON.stringify(payload)))
  })

  it.each([1, 2, 3, 4, 5, 6])('preserves the logical digest and exact payload bytes for packed/%i', (version) => {
    const current = bodyShard(unusualJSON(), version)
    expect(current.bytes).toBeGreaterThan(32_768)
    expect(physicalPayloadForProjection(current.fact, current.codec)).toBeUndefined()
    expect(validateFactShard(current.shard)).toEqual([])
    expect(admittedFactShardPayloadBytes(current.shard)).toBe(current.bytes)
    expect(physicalPayloadForProjection(current.fact, current.codec)).toBe(physicalPayloadForTransport(current.fact))
    expect(current.fact.payload).toEqual(current.payload)
    expect(factShardDigest(current.shard)).toBe(current.shard.digest)
    expect(validateFactShard(current.shard)).toEqual([])
  })

  it('does not certify a wrong digest or malformed packed body and permits a valid retry', () => {
    const current = bodyShard('valid')
    const wrong = ownWireFactShard({ ...current.shard, digest: id('fact-shard-digest', 'wrong') })
    expect(validateFactShard(wrong)).toEqual([expect.stringContaining('FACT_SHARD_DIGEST_MISMATCH')])
    expect(admittedFactShardPayloadBytes(wrong)).toBeUndefined()
    expect(physicalPayloadForProjection(current.fact, current.codec)).toBeUndefined()

    const data = packed(6, 'broken')
    data.c[0] = 'not-an-identity'
    const invalid = createFactWithPhysicalPayload(fields(),
      ownPhysicalPayloadRecord(JSON.parse(JSON.stringify({ codec: current.codec.id, data }))),
      admitFactPayloadCodecs([current.codec]), 'invalid fixture')
    const malformed = ownWireFactShard({ ...envelope([invalid]), digest: current.shard.digest })
    expect(() => validateFactShard(malformed)).toThrow('identity is invalid')
    expect(admittedFactShardPayloadBytes(malformed)).toBeUndefined()
    expect(physicalPayloadForProjection(invalid, current.codec)).toBeUndefined()

    expect(validateFactShard(current.shard)).toEqual([])
    expect(admittedFactShardPayloadBytes(current.shard)).toBe(current.bytes)
    expect(physicalPayloadForProjection(current.fact, current.codec)).toBeDefined()
  })

  it('preserves custom decoder, accessor and toJSON observations without retaining admission decodes', () => {
    const observed: string[] = []
    const payload = (name: string) => Object.defineProperty({
      get z() { observed.push(`${name}.z`); return { value: name } },
      get a() { observed.push(`${name}.a`); return name },
    }, 'toJSON', { value(key: string) { observed.push(`${name}.toJSON:${key}`); return { serialized: name } } })
    // Sharing a built-in codec name never confers its ownership or behavior.
    const codec = { id: 'typescript.body.packed/6', decode(data: unknown) {
      observed.push(`decode:${data}`)
      return payload(String(data))
    } }
    const facts = ['first', 'second'].map((name, index) => createFactWithPhysicalPayload(fields(index + 1),
      ownPhysicalPayloadRecord(JSON.parse(JSON.stringify({ codec: codec.id, data: name }))),
      admitFactPayloadCodecs([codec]), 'custom fixture'))
    const logical = envelope(['first', 'second'].map((name, index) => ({ ...fields(index + 1), payload: payload(name) })))
    const digest = factShardDigest(logical)
    const shard = ownWireFactShard({ ...envelope(facts), digest })
    observed.length = 0
    expect(validateFactShard(shard)).toEqual([])
    expect(observed).toEqual(['decode:first', 'decode:second', 'first.z', 'first.a', 'second.z', 'second.a',
      'first.toJSON:', 'second.toJSON:'])
    expect(admittedFactShardPayloadBytes(shard)).toBe(Buffer.byteLength('{"serialized":"first"}{"serialized":"second"}'))
    expect(physicalPayloadForProjection(facts[0]!, codec)).toBeUndefined()
    observed.length = 0
    expect(validateFactShard(shard)).toEqual([])
    expect(observed).toEqual([])
    const value = facts[0]!.payload
    expect(facts[0]!.payload).toBe(value)
    expect(observed).toEqual(['decode:first'])
  })

  it.each([undefined, 42n])('retains JSON budget errors for non-JSON payload %s without certification', (payload) => {
    const draft = envelope([{ ...fields(), payload }])
    const shard = { ...draft, digest: factShardDigest(draft) }
    expect(() => validateFactShard(shard)).toThrow(TypeError)
    expect(admittedFactShardPayloadBytes(shard)).toBeUndefined()
    const invalid = { ...draft, digest: id('fact-shard-digest', 'invalid') }
    expect(validateFactShard(invalid)).toEqual([expect.stringContaining('FACT_SHARD_DIGEST_MISMATCH')])
    expect(admittedFactShardPayloadBytes(invalid)).toBeUndefined()
  })

  it('keeps sparse values and Dates on their original logical and JSON byte oracles', () => {
    const sparse = new Array<unknown>(3)
    sparse[1] = undefined
    sparse[2] = new Date('2026-09-12T00:00:00.000Z')
    const payload = { sparse, omitted: undefined }
    expect(stableJson(payload)).toBe('{"sparse":[null,{"$undefined":true},{"$date":"2026-09-12T00:00:00.000Z"}]}')
    const draft = envelope([{ ...fields(), payload }])
    const shard = { ...draft, digest: factShardDigest(draft) }
    expect(validateFactShard(shard)).toEqual([])
    expect(admittedFactShardPayloadBytes(shard)).toBe(Buffer.byteLength(JSON.stringify(payload)))
  })

  it('falls back for an owned decoder returning non-JSON values without decoding again', () => {
    let decodes = 0
    const payload = () => ({ sparse: [, undefined, new Date('2026-09-12T00:00:00.000Z')] })
    const codec = ownFactPayloadCodec({ id: 'qualification.owned-non-json/1', decode() {
      decodes++
      return payload()
    } })
    const fact = createFactWithPhysicalPayload(fields(),
      ownPhysicalPayloadRecord(JSON.parse(JSON.stringify({ codec: codec.id, data: 'token' }))),
      admitFactPayloadCodecs([codec]), 'non-JSON fixture')
    const logical = envelope([{ ...fields(), payload: payload() }])
    const shard = ownWireFactShard({ ...envelope([fact]), digest: factShardDigest(logical) })
    expect(validateFactShard(shard)).toEqual([])
    expect(decodes).toBe(1)
    expect(admittedFactShardPayloadBytes(shard)).toBe(Buffer.byteLength(JSON.stringify(payload())))
  })

  it.each(['constructor', 'species'] as const)('preserves canonical array %s customization during owned admission', (kind) => {
    const current = bodyShard({ nested: ['value'] })
    const logical = envelope([{ ...fields(), payload: current.payload }])
    const target = kind === 'constructor' ? Array.prototype : Array
    const key = kind === 'constructor' ? 'constructor' : Symbol.species
    const previous = Object.getOwnPropertyDescriptor(target, key)!
    const observed: string[] = []
    class CanonicalArray extends Array {
      toJSON(key: string) { observed.push(key); return { canonicalArray: key } }
    }
    let diagnostics: readonly string[] | undefined, bytes: number | undefined, expectedBytes: number | undefined
    try {
      Object.defineProperty(target, key, kind === 'constructor'
        ? { ...previous, value: { [Symbol.species]: CanonicalArray } }
        : { configurable: true, get: () => CanonicalArray })
      const digest = factShardDigest(logical)
      const shard = ownWireFactShard({ ...current.shard, digest })
      expectedBytes = Buffer.byteLength(JSON.stringify(current.payload))
      diagnostics = validateFactShard(shard)
      bytes = admittedFactShardPayloadBytes(shard)
    } finally { Object.defineProperty(target, key, previous) }
    expect(observed).toContain('facts')
    expect(diagnostics).toEqual([])
    expect(bytes).toBe(expectedBytes)
  })

  it('keeps the committed generation and old pin intact after a rejected replacement', async () => {
    const store = createMemoryAnalysisStore()
    const first = transaction(1, 'before')
    try {
      await store.commit(first)
      const pin = await store.open(first.next.universe)
      try {
        const before = (await pin.facts()).facts.map(fact => fact.payload)
        const second = transaction(2, 'after', first.next.id)
        const invalid = ownWireFactShard({ ...second.upserts[0]!, digest: id('fact-shard-digest', 'corrupt') })
        await expect(store.commit({ ...second, upserts: [invalid] })).rejects.toThrow('SHARD')
        expect(admittedFactShardPayloadBytes(invalid)).toBeUndefined()
        expect((await store.current(first.next.universe))?.id).toBe(first.next.id)
        expect((await pin.facts()).facts.map(fact => fact.payload)).toEqual(before)
        await store.commit(second)
        expect((await store.current(first.next.universe))?.id).toBe(second.next.id)
        expect((await pin.facts()).facts.map(fact => fact.payload)).toEqual(before)
      } finally { await pin.dispose() }
    } finally { await store.dispose() }
  })

  it('enforces the exact decoded byte boundary through real JSON ingress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-owned-admission-'))
    const current = transaction(1, unusualJSON())
    const bytes = bodyShard(unusualJSON()).bytes
    const wire = { ...current, upserts: current.upserts.map(shard => ({ ...shard,
      facts: shard.facts.map(fact => ({ ...factHeader(fact), physicalPayload: physicalPayloadForTransport(fact) })),
    })) }
    const script = join(root, 'sidecar.mjs')
    await writeFile(script, String.raw`import { createInterface } from 'node:readline'
const transaction = JSON.parse(${JSON.stringify(JSON.stringify(wire))})
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (request.kind === 'dispose') process.exit(0)
  const frame = JSON.stringify({ id: request.id, protocolVersion: 1, kind: 'transaction', transaction })
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  process.stdout.write(frame + '\n')
})
`)
    try {
      for (const limits of [
        { maximumTransactionBytes: bytes, maximumDecodedShardBytes: bytes },
        { maximumTransactionBytes: bytes - 1, maximumDecodedShardBytes: bytes },
        { maximumTransactionBytes: bytes, maximumDecodedShardBytes: bytes - 1 },
      ]) {
        const session = await createProcessNativeAnalysisSessionFactory({
          command: process.execPath, arguments: [script], payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS,
          maximumPhysicalTransactionBytes: 2 * 1024 * 1024, ...limits,
        }).open({ root, config: 'tsconfig.json', capabilities: ['typescript.body'] })
        try {
          const result = session.request({ id: 1, kind: 'refresh' })
          if (limits.maximumTransactionBytes === bytes && limits.maximumDecodedShardBytes === bytes) {
            await expect(result).resolves.toMatchObject({ kind: 'transaction', transaction: { next: { id: current.next.id } } })
          } else await expect(result).rejects.toMatchObject({ cause: expect.objectContaining({
            message: expect.stringContaining('decoded semantic payload limit'),
          }) })
        } finally { await session.dispose() }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

function transaction(sequence: number, value: unknown, base?: FactTransaction['base']): FactTransaction {
  // Native wire shards currently omit the optional portable capability list.
  const current = bodyShard(value, 6, sequence, false)
  const draft = {
    universe: id('project-universe', 'fixture'),
    producer: { id: id('producer', 'fixture'), name: 'fixture', version: '1', protocolVersion: 1 },
    sourceManifest: id('source-manifest', sequence), capabilities: ['typescript.body'],
  }
  const manifest = [shardReference(current.shard)]
  const generation = generationIdentity(draft, manifest)
  const shard = ownWireFactShard({ ...current.shard, facts: [bindPhysicalFact(current.fact, generation)] })
  return { protocolVersion: 1, ...(base ? { base } : {}), next: { ...draft, id: generation, sequence },
    manifest, upserts: [shard], deletes: [] }
}

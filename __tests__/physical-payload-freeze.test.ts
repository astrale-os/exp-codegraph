import { describe, expect, it, vi } from 'vitest'
import { factShardDigest, validateFactShard } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, admittedFactShardPayloadBytes, createFactWithPhysicalPayload,
  createFactWithSemanticPayload, ownFactPayloadCodec, ownPhysicalPayloadRecord,
  physicalPayloadForTransport,
} from '../analysis/facts/representation/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'

const fields = {
  id: deriveAnalysisId('fact', 'freeze', 1), generation: deriveAnalysisId('generation', 'freeze', 1),
  namespace: 'qualification', schemaVersion: 1, kind: 'value', subject: 'freeze',
  completeness: { kind: 'complete' } as const,
  provenance: { pass: deriveAnalysisId('pass', 'freeze', 1), passVersion: '1', evidence: [], inputs: [] },
}

describe('physical payload freezing', () => {
  it.each([false, true])('preserves owned JSON identity and freezes descendants with frozen parents=%s', (frozen) => {
    const serialized = '{"codec":"qualification.freeze/1","data":{"rows":[[0,1,2],[3,4,5]],"text":"é 😀 \\u2028",' +
      '"open":{"2":false,"__proto__":{"values":[null,true]},"constructor":[{"value":"stable"}]}}}'
    const input = ownPhysicalPayloadRecord(JSON.parse(serialized) as {
      codec: string
      data: { rows: number[][]; text: string; open: Record<string, unknown> }
    })
    const expected: unknown = JSON.parse(serialized).data
    if (frozen) {
      Object.freeze(input)
      Object.freeze(input.data)
      Object.freeze(input.data.rows)
      Object.freeze(input.data.open)
    }
    const decode = vi.fn((data: unknown) => structuredClone(data))
    const codec = ownFactPayloadCodec({ id: input.codec, decode })
    const fact = createFactWithPhysicalPayload(fields, input, admitFactPayloadCodecs([codec]), 'owned')
    expect(decode).not.toHaveBeenCalled()
    expect(physicalPayloadForTransport(fact)?.data).toBe(input.data)
    expect(JSON.stringify(input)).toBe(serialized.replace('\\u2028', '\u2028'))
    expectDeeplyFrozen(input.data)
    expect(() => input.data.rows[0]!.push(9)).toThrow(TypeError)
    expect(Reflect.set(input.data.rows[1]!, '0', 9)).toBe(false)

    const shard = { key: deriveAnalysisId('fact-shard-key', 'freeze', 1), namespace: fields.namespace,
      schemaVersion: 1, completion: fields.completeness, facts: [fact] }
    const logical = { ...shard, facts: [createFactWithSemanticPayload(fields, expected)] }
    const digest = factShardDigest(logical)
    expect(factShardDigest(shard)).toBe(digest)
    const admitted = { ...shard, digest }
    expect(validateFactShard(admitted)).toEqual([])
    expect(admittedFactShardPayloadBytes(admitted)).toBe(Buffer.byteLength(JSON.stringify(expected)))
    expect(fact.payload).toEqual(expected)
    expectDeeplyFrozen(fact.payload)
  })

  it('preserves unowned accessor handling and custom decoder laziness', () => {
    const accessor = vi.fn(() => ({ unseen: true }))
    const data = { rows: [[1, 2]], nested: { value: 'data' } }
    Object.defineProperty(data, 'dynamic', { enumerable: true, get: accessor })
    const decode = vi.fn(() => ({ value: 'custom' }))
    const codec = { id: 'qualification.custom-freeze/1', decode }
    const fact = createFactWithPhysicalPayload(fields, { codec: codec.id, data }, admitFactPayloadCodecs([codec]), 'unowned')
    expect(accessor).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
    expect(Object.getOwnPropertyDescriptor(data, 'dynamic')?.get).toBe(accessor)
    expect(Object.isFrozen(data)).toBe(true)
    expect(Object.isFrozen(data.rows[0])).toBe(true)
    expect(Object.isFrozen(data.nested)).toBe(true)
    expect(fact.payload).toEqual({ value: 'custom' })
    expect(fact.payload).toBe(fact.payload)
    expect(decode).toHaveBeenCalledTimes(1)
    expect(accessor).not.toHaveBeenCalled()
  })
})

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child)
}

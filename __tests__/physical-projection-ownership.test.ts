import { describe, expect, it, vi } from 'vitest'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import { factShardDigest, validateFactShard } from '../analysis/facts/index.ts'
import {
  admitFactPayloadCodecs, bindPhysicalFact, createFactWithPhysicalPayload, ownFactPayloadCodec,
  ownPhysicalPayloadRecord, physicalPayloadForProjection,
} from '../analysis/facts/representation/index.ts'

describe('physical projection ownership', () => {
  it('requires owned JSON ingress, successful admission and the exact composed decoder', () => {
    const decode = vi.fn((data: unknown) => ({ value: (data as { value: string }).value }))
    const codec = ownFactPayloadCodec({ id: 'qualification.projection/1', decode })
    const sameName = ownFactPayloadCodec({ id: codec.id, decode })
    const fields = {
      id: deriveAnalysisId('fact', 'projection', 1), generation: deriveAnalysisId('generation', 'projection', 1),
      namespace: 'qualification', schemaVersion: 1, kind: 'value', subject: 'projection',
      completeness: { kind: 'complete' } as const,
      provenance: { pass: deriveAnalysisId('pass', 'projection', 1), passVersion: '1', evidence: [], inputs: [] },
    }
    const input = ownPhysicalPayloadRecord(JSON.parse('{"codec":"qualification.projection/1","data":{"value":"present"}}'))
    const fact = createFactWithPhysicalPayload(fields, input, admitFactPayloadCodecs([codec]), 'fixture')
    expect(physicalPayloadForProjection(fact, codec)).toBeUndefined()
    const draft = { key: deriveAnalysisId('fact-shard', 'projection', 1), namespace: fields.namespace,
      schemaVersion: 1, completion: { kind: 'complete' } as const, facts: [fact] }
    const digest = factShardDigest(draft)
    expect(physicalPayloadForProjection(fact, codec)).toBeUndefined()
    expect(validateFactShard({ ...draft, digest })).toEqual([])
    const calls = decode.mock.calls.length
    expect(physicalPayloadForProjection(fact, codec)?.data).toBe(input.data)
    expect(physicalPayloadForProjection(fact, sameName)).toBeUndefined()
    const rebound = bindPhysicalFact(fact, deriveAnalysisId('generation', 'projection', 2))
    expect(physicalPayloadForProjection(rebound, codec)).toBe(physicalPayloadForProjection(fact, codec))
    const inherited = Object.create(fact)
    Object.defineProperty(inherited, 'payload', { value: { value: 'forged' } })
    expect(physicalPayloadForProjection(inherited, codec)).toBeUndefined()
    expect(Reflect.ownKeys(fact).filter((key) => typeof key === 'symbol')).toEqual([])
    expect(decode).toHaveBeenCalledTimes(calls)
    expect(Object.isFrozen(input.data)).toBe(true)

    const unowned = createFactWithPhysicalPayload(fields,
      Object.freeze({ codec: codec.id, data: Object.freeze({ value: 'present' }) }), admitFactPayloadCodecs([codec]), 'unowned')
    const other = { ...draft, facts: [unowned] }
    expect(validateFactShard({ ...other, digest: factShardDigest(other) })).toEqual([])
    expect(physicalPayloadForProjection(unowned, codec)).toBeUndefined()
    const forged = createFactWithPhysicalPayload(fields,
      ownPhysicalPayloadRecord(JSON.parse(JSON.stringify(input))), admitFactPayloadCodecs([sameName]), 'other decoder')
    const forgedShard = { ...draft, facts: [forged] }
    expect(validateFactShard({ ...forgedShard, digest: factShardDigest(forgedShard) })).toEqual([])
    expect(physicalPayloadForProjection(forged, codec)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { resolutionResultBytes, ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import type { EvaluatedValueResult } from '../analysis/typescript/value/index.ts'

const result: EvaluatedValueResult<unknown> = Object.freeze({ kind: 'known', value: 'cached', evidence: Object.freeze([]),
  limits: Object.freeze({ maximumDepth: 64, maximumSteps: 4096, maximumAlternatives: 32 }) })

describe('resident value cache ownership and bounds', () => {
  it('bounds every model and budget together, admits recurring demands and rejects stale dependencies', () => {
    const cache = new ValueResolutionCache(2, 10000)
    cache.put('model-a/budget-1', result, 50)
    cache.put('model-b/budget-2', result, 50)
    expect(cache.get('model-a/budget-1', () => true)).toBe(result)
    expect(cache.get('model-c/budget-3', () => true)).toBeUndefined()
    cache.put('model-c/budget-3', result, 50)
    expect(cache.size).toBe(2)
    expect(cache.get('model-b/budget-2', () => true)).toBeUndefined()
    expect(cache.get('model-a/budget-1', () => false)).toBeUndefined()
    expect(cache.size).toBe(1)
    cache.close()
    cache.put('late-reader', result, 50)
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })

  it('retires one shared basis once when equivalent witnesses were read more than once', () => {
    const cache = new ValueResolutionCache()
    const first = { token: {}, changed: new Set<string>() }
    cache.get('initialize', () => true, first)
    const one = Object.freeze({ key: 'function:duplicate', fingerprint: 'same' })
    const basis = cache.basis([one, Object.freeze({ ...one })], result.evidence, result.limits)
    cache.put('first-reader', result, 100, basis)
    cache.put('second-reader', result, 100, basis)
    const next = { token: {}, parent: first.token, changed: new Set([one.key]) }
    expect(cache.get('first-reader', () => true, next)).toBeUndefined()
    expect(cache.get('second-reader', () => true, next)).toBeUndefined()
    expect(cache.size).toBe(0)
    expect(Number.isFinite(cache.bytes)).toBe(true)
  })

  it('retains more than 1024 small proofs without increasing the byte bound', () => {
    const cache = new ValueResolutionCache()
    for (let index = 0; index < 4096; index++) {
      expect(cache.get(String(index), () => true)).toBeUndefined()
      cache.put(String(index), result, 1024)
    }
    for (let index = 0; index < 4096; index++) expect(cache.get(String(index), () => true)).toBe(result)
    expect(cache.size).toBe(4096)
    expect(cache.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
  })

  it('keeps reusable work through cyclic scans larger than its byte capacity', () => {
    const cache = new ValueResolutionCache()
    const hits: number[] = []
    for (let cycle = 0; cycle < 4; cycle++) {
      let count = 0
      for (let index = 0; index < 16384; index++) {
        const key = `large-scan:${index}`
        if (cache.get(key, () => true)) count++
        else cache.put(key, result, 1024)
      }
      hits.push(count)
      expect(cache.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    }
    expect(hits[0]).toBe(0)
    for (const count of hits.slice(1)) expect(count).toBeGreaterThan(4096)
  })

  it('invalidates only readers of changed positive or absent keys across direct revisions', () => {
    const cache = new ValueResolutionCache()
    const first = { token: {}, changed: new Set<string>() }
    cache.get('establish', () => true, first)
    const present = Object.freeze({ key: 'function:shared', fingerprint: 'first-body' })
    const absent = Object.freeze({ key: 'aliases:unwritten', fingerprint: undefined })
    cache.put('shared-reader', result, 100, cache.basis([present], result.evidence, result.limits))
    cache.put('absence-reader', result, 100, cache.basis([absent], result.evidence, result.limits))
    let validations = 0
    const validate = () => { validations++; return true }
    const unrelated = { token: {}, parent: first.token, changed: new Set(['function:other']) }
    expect(cache.get('shared-reader', validate, unrelated)).toBe(result)
    expect(cache.get('absence-reader', validate, unrelated)).toBe(result)
    expect(validations).toBe(0)
    const addition = { token: {}, parent: unrelated.token, changed: new Set([absent.key]) }
    expect(cache.get('absence-reader', validate, addition)).toBeUndefined()
    expect(cache.get('shared-reader', validate, addition)).toBe(result)
    const edit = { token: {}, parent: addition.token, changed: new Set([present.key]) }
    expect(cache.get('shared-reader', validate, edit)).toBeUndefined()
    cache.put('current', result, 100, cache.basis([present], result.evidence, result.limits))
    // A retained old snapshot must validate against its own facts without a reverse delta.
    expect(cache.get('current', () => { validations++; return false }, first)).toBeUndefined()
    expect(validations).toBe(1)
    cache.close()
    expect(cache.bytes).toBe(0)
  })

  it('shares immutable dependency witnesses and counts retained inverse memberships', () => {
    const cache = new ValueResolutionCache()
    const witness = Object.freeze({ key: 'function:shared', fingerprint: 'payload' })
    cache.put('one', result, 100, cache.basis([witness], result.evidence, result.limits))
    expect(cache.dependency(Object.freeze({ ...witness }))).toBe(witness)
    expect(cache.dependency(Object.freeze({ ...witness, fingerprint: 'changed' }))).not.toBe(witness)
    for (let index = 0; index < 4096; index++) cache.put(`shared:${index}`, result, 100, cache.basis([witness], result.evidence, result.limits))
    expect(cache.size).toBe(4097)
    expect(cache.bytes).toBeLessThan(2 * 1024 * 1024)
    cache.close()
    expect(cache.bytes).toBe(0)
  })

  it('validates a shared basis once after a discontinuous revision and then follows its deltas', () => {
    const cache = new ValueResolutionCache()
    const first = { token: {}, changed: new Set<string>() }
    cache.get('initialize', () => true, first)
    const dependency = Object.freeze({ key: 'function:stable', fingerprint: 'body' })
    const basis = cache.basis([dependency], result.evidence, result.limits)
    cache.put('one', result, 100, basis)
    cache.put('two', result, 100, basis)
    const independent = { token: {}, changed: new Set<string>() }
    let validations = 0
    const validate = () => { validations++; return true }
    expect(cache.get('one', validate, independent)).toBe(result)
    expect(cache.get('two', validate, independent)).toBe(result)
    expect(validations).toBe(1)
    const edited = { token: {}, parent: independent.token, changed: new Set([dependency.key]) }
    expect(cache.get('two', validate, edited)).toBeUndefined()
    expect(validations).toBe(1)
  })

  it('also bounds retained result and fingerprint bytes rather than entry count alone', () => {
    const cache = new ValueResolutionCache(100, 1000)
    cache.put('a', result, 500)
    cache.put('b', result, 500)
    expect(cache.size).toBe(1)
    expect(cache.bytes).toBeLessThanOrEqual(1000)
    cache.put('oversized', result, 1001)
    expect(cache.size).toBe(1)
  })

  it('rejects oversized shared evidence without corrupting accounting or losing resident work', () => {
    const cache = new ValueResolutionCache()
    cache.put('resident', result, 100)
    const before = cache.bytes
    const evidence = Object.freeze(['x'.repeat(1024 * 1024)]) as typeof result.evidence
    cache.put('oversized-basis', result, 100, cache.basis([], evidence, result.limits))
    expect(cache.size).toBe(1)
    expect(cache.bytes).toBe(before)
    expect(cache.get('resident', () => true)).toBe(result)
  })

  it('does not certify shallow-frozen atoms, accessors, proxies or opaque mutable objects', () => {
    expect(resolutionResultBytes(result)).toBeGreaterThan(0)
    expect(resolutionResultBytes({ value: Object.freeze({ nested: {} }) })).toBeUndefined()
    let reads = 0
    const accessor = Object.freeze({ get value() { reads++; return 1 } })
    expect(resolutionResultBytes({ atom: accessor })).toBeUndefined()
    const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('must not inspect proxy') } })
    expect(resolutionResultBytes({ atom: proxy })).toBeUndefined()
    expect(reads).toBe(0)
    expect(resolutionResultBytes({ atom: Object.freeze(new Map()) })).toBeUndefined()
    expect(resolutionResultBytes({ value: 'x'.repeat(1024 * 1024) })).toBeUndefined()
  })
})

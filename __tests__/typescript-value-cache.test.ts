import { describe, expect, it } from 'vitest'
import { resolutionResultBytes, ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import type { EvaluatedValueResult } from '../analysis/typescript/value/index.ts'

const result: EvaluatedValueResult<unknown> = Object.freeze({ kind: 'known', value: 'cached', evidence: Object.freeze([]),
  limits: Object.freeze({ maximumDepth: 64, maximumSteps: 4096, maximumAlternatives: 32 }) })

describe('resident value cache ownership and bounds', () => {
  it('bounds every model and budget together, evicts least recently used entries and rejects stale dependencies', () => {
    const cache = new ValueResolutionCache(2, 10000)
    cache.put('model-a/budget-1', result, 50)
    cache.put('model-b/budget-2', result, 50)
    expect(cache.get('model-a/budget-1', () => true)).toBe(result)
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

  it('also bounds retained result and fingerprint bytes rather than entry count alone', () => {
    const cache = new ValueResolutionCache(100, 1000)
    cache.put('a', result, 500)
    cache.put('b', result, 500)
    expect(cache.size).toBe(1)
    expect(cache.bytes).toBeLessThanOrEqual(1000)
    cache.put('oversized', result, 1001)
    expect(cache.size).toBe(1)
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

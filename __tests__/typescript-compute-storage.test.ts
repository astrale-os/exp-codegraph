import { describe, expect, it } from 'vitest'
import { ComputationReceipt, COMPUTATION_RECEIPT_BYTES } from '../analysis/typescript/value/symbolic/receipt.ts'
import { ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import { capturePortable, restorePortable } from '../analysis/typescript/project/portable.ts'

describe('bounded semantic computation storage', () => {
  it('preserves all witnessed keys after compaction, including negative and unusual names', () => {
    for (const size of [0, 1, 100, 10_000, 80_000]) {
      const keys = Array.from({ length: size }, (_, index) => `${index % 2 ? 'function:' : 'aliases:'}${index}\ud800\u0000\udfff`)
      const receipt = new ComputationReceipt()
      for (const key of keys) receipt.add(key)
      const compact = receipt.compact()!
      expect(compact).toBeDefined()
      expect(compact.bytes).toBeLessThanOrEqual(COMPUTATION_RECEIPT_BYTES + 96)
      for (const key of keys) expect(compact.intersects([key])).toBe(true)
      expect(compact.intersects([])).toBe(false)
      if (size === 0) expect(compact.intersects(['absent'])).toBe(false)
    }
  })

  it('shares the original envelope with proofs and releases construction reservations exactly once', () => {
    const cache = new ValueResolutionCache(Infinity, 4096)
    const bytes = cache.bytes
    const release = cache.reserve(2048)!
    expect(release).toBeTypeOf('function')
    expect(cache.bytes).toBe(bytes + 2048)
    expect(cache.reserve(4096)).toBeUndefined()
    release(); release()
    expect(cache.bytes).toBe(bytes)
    const outstanding = cache.reserve(2048)!
    cache.close()
    outstanding()
    expect(cache.reserve(1)).toBeUndefined()
    expect(cache.bytes).toBe(0)
  })

  it('owns portable data without invoking accessors or retaining caller graphs', () => {
    const child = { n: -0 }
    const input = { absent: undefined, list: [, undefined], one: child, two: child }
    const captured = capturePortable(input)!
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(captured.value.one)).toBe(true)
    child.n = 12
    const restored = restorePortable<typeof input>(captured.encoded)
    expect(Object.is(restored.one.n, -0)).toBe(true)
    expect(restored.one).toBe(restored.two)
    expect(restored.one).not.toBe(child)
    expect(0 in restored.list).toBe(false)
    expect(1 in restored.list).toBe(true)
    expect('absent' in restored).toBe(true)
    let getters = 0
    expect(capturePortable({ get dynamic() { getters++; return 1 } })).toBeUndefined()
    expect(getters).toBe(0)
    expect(capturePortable(new Date())).toBeUndefined()
    expect(capturePortable({ [Symbol('proof')]: child })).toBeUndefined()
    expect(capturePortable(new Proxy({}, { ownKeys() { throw Error('must not inspect') } }))).toBeUndefined()
  })
})

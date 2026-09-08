import { describe, expect, it } from 'vitest'
import type { FactId } from '../analysis/identity/index.ts'
import type { EvaluatedValueResult } from '../analysis/typescript/value/index.ts'
import { ResidentProofCoordinates } from '../analysis/typescript/value/symbolic/coordinates.ts'
import { ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'

const limits = Object.freeze({ maximumDepth: 64, maximumSteps: 4096, maximumAlternatives: 32 })
const fact = (value: string) => value as FactId

describe('resident proof coordinates', () => {
  it('retains exact coordinates only while a resident basis owns them', () => {
    const coordinates = new ResidentProofCoordinates()
    const first = coordinates.prepare([fact('one'), fact('one'), fact('two')], limits)
    expect(coordinates.bytes).toBe(0)
    expect(first.evidence[0]).toBe(first.evidence[1])
    coordinates.retain(first)
    const bytes = coordinates.bytes
    const second = coordinates.prepare([fact('two'), fact('one')], { ...limits })
    expect(second.evidence[0]).toBe(first.evidence[2])
    expect(second.budget).toBe(first.budget)
    expect(second.budget.limits).toBe(limits)
    expect(coordinates.additionalBytes(second)).toBe(0)
    coordinates.retain(second)
    expect(coordinates.bytes).toBe(bytes)
    coordinates.release(first)
    expect(coordinates.bytes).toBe(bytes)
    coordinates.release(second)
    expect(coordinates.bytes).toBe(0)
    const third = coordinates.prepare([fact('one')], limits)
    expect(third.evidence[0]).not.toBe(first.evidence[0])
    expect(third.evidence[0]!.id).not.toBe(first.evidence[0]!.id)
  })

  it('does not conflate exact strings, evidence boundaries or distinct budgets', () => {
    const coordinates = new ResidentProofCoordinates()
    const first = coordinates.prepare([fact('a,b'), fact('c')], limits)
    coordinates.retain(first)
    const other = coordinates.prepare([fact('a'), fact('b,c')], { ...limits, maximumSteps: 1 })
    expect(other.evidence.every(token => !first.evidence.includes(token))).toBe(true)
    expect(other.budget).not.toBe(first.budget)
    expect(other.budget.limits.maximumSteps).toBe(1)
    coordinates.retain(other)
    coordinates.release(first)
    expect(coordinates.bytes).toBeGreaterThan(0)
    coordinates.release(other)
    expect(coordinates.bytes).toBe(0)
  })

  it('rejects stale coordinates and releases the dictionary after clear', () => {
    const coordinates = new ResidentProofCoordinates()
    const old = coordinates.prepare([fact('same')], limits)
    coordinates.retain(old)
    coordinates.release(old)
    const current = coordinates.prepare([fact('same')], limits)
    coordinates.retain(current)
    const before = coordinates.bytes
    expect(coordinates.additionalBytes(old)).toBeUndefined()
    expect(coordinates.bytes).toBe(before)
    coordinates.clear()
    expect(coordinates.bytes).toBe(0)
  })

  it('compacts long identifiers without changing receipt, atom or evidence identity', () => {
    const cache = new ValueResolutionCache()
    const emptyBytes = cache.bytes
    const evidence = Object.freeze([fact('source/'.repeat(256)), fact('second/'.repeat(256))])
    const witness = Object.freeze({ key: 'function:one', fingerprint: 'body' })
    const basis = cache.basis([witness], evidence, limits)
    expect(basis.key.length).toBeLessThan(100)
    const atom = Object.freeze({ instance: 'opaque' })
    const result: EvaluatedValueResult<unknown> = Object.freeze({ kind: 'known', value: atom,
      evidence: basis.evidence, limits: basis.limits })
    cache.put('one', result, 100, basis)
    expect(cache.basis([witness], [...evidence], { ...limits })).toBe(basis)
    expect(cache.get('one', () => true)).toBe(result)
    expect((cache.get('one', () => true) as typeof result).value).toBe(atom)
    expect(result.evidence).toBe(basis.evidence)
    expect(cache.get('one', () => false)).toBeUndefined()
    expect(cache.bytes).toBe(emptyBytes)
    const restored = cache.basis([witness], evidence, limits)
    expect(restored.evidence).toEqual(evidence)
    expect(restored.key).not.toBe(basis.key)
    expect(result.value).toBe(atom)
  })

  it('releases coordinates through eviction and direct revision invalidation', () => {
    const cache = new ValueResolutionCache(1)
    const initialBytes = cache.bytes
    const revision = { token: {}, changed: new Set<string>() }
    cache.get('start', () => true, revision)
    const put = (key: string) => {
      const basis = cache.basis([Object.freeze({ key, fingerprint: key })], [fact(key)], limits)
      const result = Object.freeze({ kind: 'known' as const, value: key, evidence: basis.evidence, limits: basis.limits })
      cache.put(key, result, 100, basis)
      return result
    }
    put('first')
    cache.get('second', () => true, revision)
    const second = put('second')
    expect(cache.size).toBe(1)
    expect(cache.get('first', () => true, revision)).toBeUndefined()
    expect(cache.get('second', () => true, revision)).toBe(second)
    const next = { token: {}, parent: revision.token, changed: new Set(['second']) }
    expect(cache.get('second', () => true, next)).toBeUndefined()
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(initialBytes)
    cache.close()
    expect(cache.bytes).toBe(0)
  })

  it('rejects a prepared basis whose vocabulary was replaced without disturbing its current owner', () => {
    const cache = new ValueResolutionCache()
    const emptyBytes = cache.bytes
    const evidence = Object.freeze([fact('shared')])
    const first = cache.basis([], evidence, limits)
    const stale = cache.basis([], evidence, limits)
    const result = Object.freeze({ kind: 'known' as const, value: 'resident', evidence: first.evidence, limits: first.limits })
    cache.put('resident', result, 100, first)
    const residentBytes = cache.bytes
    cache.put('stale', Object.freeze({ ...result, evidence: stale.evidence, limits: stale.limits }), 100, stale)
    expect(cache.get('stale', () => true)).toBeUndefined()
    expect(cache.get('resident', () => true)).toBe(result)
    expect(cache.bytes).toBe(residentBytes)
    expect(cache.get('resident', () => false)).toBeUndefined()
    expect(cache.bytes).toBe(emptyBytes)
    expect(result.evidence).toBe(first.evidence)
  })

  it('recreates an evicted shared basis without losing or double-counting its vocabulary', () => {
    const maximumBytes = 8192
    const cache = new ValueResolutionCache(1, maximumBytes)
    const emptyBytes = cache.bytes
    const witness = Object.freeze({ key: 'function:shared', fingerprint: 'body' })
    const basis = cache.basis([witness], [fact('shared'), fact('shared')], limits)
    const result = Object.freeze({ kind: 'known' as const, value: 'same', evidence: basis.evidence, limits: basis.limits })
    cache.put('first', result, 100, basis)
    const residentBytes = cache.bytes
    cache.get('other', () => true)
    cache.put('other', result, 100, basis)
    expect(cache.size).toBe(1)
    expect(cache.get('first', () => true)).toBeUndefined()
    expect(cache.get('other', () => true)).toBe(result)
    expect(cache.bytes).toBe(residentBytes)
    expect(cache.bytes).toBeLessThanOrEqual(maximumBytes)
    expect(cache.basis([witness], basis.evidence, limits)).toBe(basis)
    expect(cache.get('other', () => false)).toBeUndefined()
    expect(cache.bytes).toBe(emptyBytes)
  })

  it('keeps accounting bounded through recurring scans with overlapping and changing proof vocabularies', () => {
    const maximumBytes = 16 * 1024
    const cache = new ValueResolutionCache(Infinity, maximumBytes)
    const emptyBytes = cache.bytes
    let admitted = 0
    for (let cycle = 0; cycle < 8; cycle++) {
      for (let index = 0; index < 24; index++) {
        const key = `demand:${index}`
        if (cache.get(key, () => cycle % 3 !== 0)) continue
        const evidence = [fact(`shared:${index % 4}`), fact(`local:${index}:${cycle}`)]
        const basis = cache.basis([Object.freeze({ key: `function:${index % 8}`, fingerprint: String(cycle >> 1) })], evidence, limits)
        const result = Object.freeze({ kind: 'known' as const, value: index, evidence: basis.evidence, limits: basis.limits })
        cache.put(key, result, 100 + index * 16, basis)
        expect(cache.bytes).toBeGreaterThanOrEqual(emptyBytes)
        expect(cache.bytes).toBeLessThanOrEqual(maximumBytes)
        if (cache.get(key, () => true) === result) admitted++
      }
    }
    expect(admitted).toBeGreaterThan(24)
    for (let index = 0; index < 24; index++) cache.get(`demand:${index}`, () => false)
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(emptyBytes)
    cache.close()
    expect(cache.bytes).toBe(0)
  })

  it('shares a resident evidence vocabulary across thousands of independent bases', () => {
    const cache = new ValueResolutionCache()
    const evidence = Object.freeze(Array.from({ length: 12 }, (_, index) => fact(`${index}:${'evidence/'.repeat(32)}`)))
    for (let index = 0; index < 4096; index++) {
      const basis = cache.basis([Object.freeze({ key: `function:${index}`, fingerprint: 'body' })], evidence, limits)
      const result = Object.freeze({ kind: 'known' as const, value: index, evidence: basis.evidence, limits: basis.limits })
      cache.put(String(index), result, 100, basis)
    }
    expect(cache.size).toBe(4096)
    expect(cache.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    for (let index = 0; index < 4096; index++) expect(cache.get(String(index), () => true)).toMatchObject({ value: index })
    cache.close()
    expect(cache.bytes).toBe(0)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import type { AnalysisQuery, CapabilityStatus } from '../analysis/query/index.ts'
import { SemanticComputationCache } from '../analysis/typescript/project/compute.ts'
import type { TypeScriptSemanticReader } from '../analysis/typescript/project/model.ts'
import { ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import { IndexedValues, type ValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'
import {
  ComputationReceipt, COMPUTATION_RECEIPT_BYTES, COMPUTATION_WITNESS_BYTES, recordComputationWitness,
} from '../analysis/typescript/value/symbolic/receipt.ts'

afterEach(() => vi.restoreAllMocks())

const limits = Object.freeze({ maximumSteps: 100, maximumDepth: 10, maximumAlternatives: 10 })
const capabilities = ['typescript.body', 'typescript.source'].map((capability) => ({
  capability, completeness: { kind: 'complete' },
})) as CapabilityStatus[]
const query = (id: string) => ({ generation: { id }, capabilities: async () => capabilities }) as unknown as AnalysisQuery
const tags = () => new Float64Array(COMPUTATION_WITNESS_BYTES / Float64Array.BYTES_PER_ELEMENT)

describe('bounded exact computation witness collection', () => {
  it('keeps every read through slot collisions, replacement and unsafe identities', () => {
    const seen = tags(), receipt = new ComputationReceipt()
    const keys = new Set<string>()
    const read = (identity: number | undefined, key: string) => {
      keys.add(key)
      const fresh = recordComputationWitness(seen, identity)
      if (fresh) receipt.add(key)
      return fresh
    }
    expect(seen.byteLength).toBe(32 * 1024)
    expect(read(1, 'function:first')).toBe(true)
    expect(read(1, 'function:first')).toBe(false)
    expect(read(4097, 'function:collision')).toBe(true)
    expect(read(1, 'function:first')).toBe(true)
    // Full Float64 tags distinguish identities with equal low 32 bits.
    expect(read(2 ** 32 + 1, 'function:wide')).toBe(true)
    expect(read(1, 'function:first')).toBe(true)
    for (const [index, identity] of [undefined, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5].entries()) {
      expect(read(identity, `absent:${index}\ud800\u0000`)).toBe(true)
      expect(read(identity, `another:${index}\udfff`)).toBe(true)
    }
    const compact = receipt.compact()!
    for (const key of keys) expect(compact.intersects([key])).toBe(true)
    expect(recordComputationWitness(tags(), 1)).toBe(true)
  })

  it('never recycles a witness identity when proofs are evicted and falls back to exact basis keys', () => {
    const values = new ValueResolutionCache(Infinity, 8192)
    try {
      const first = Object.freeze({ key: 'function:shared', fingerprint: 'before' })
      const identity = values.witnessIdentity(first)
      const basis = values.basis([first], [], limits)
      values.put('first', { kind: 'known', value: 1, evidence: [], limits }, 64, basis)
      expect(values.size).toBe(1)
      const release = values.reserve(values.capacity)!
      expect(values.size).toBe(0)
      release()
      expect(values.witnessIdentity(first)).toBe(identity)
      const changed = Object.freeze({ key: first.key, fingerprint: 'after' })
      expect(values.witnessIdentity(changed)).not.toBe(identity)
      vi.spyOn(values, 'witnessIdentity').mockReturnValue(undefined)
      expect(values.basis([first], [], limits).key).not.toBe(values.basis([changed], [], limits).key)
      expect(values.basis([{ key: first.key, fingerprint: undefined }], [], limits).key)
        .not.toBe(values.basis([{ key: 'function:another', fingerprint: undefined }], [], limits).key)
    } finally { values.close() }
  })

  it('collects repeated absent proofs once per computation and invalidates across later pins', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const missing = deriveAnalysisId('occurrence', 'computation-witness-test', 'missing')
    const dependency = `occurrence:${missing}`
    const before = IndexedValues.empty().update([], [], true, capabilities)
    const later: ValueIndex = { ...before, dependency: before.dependency.bind(before),
      revision: { ...before.revision, token: {}, parent: before.revision.token, changed: new Set([dependency]) } }
    let executions = 0
    const add = vi.spyOn(ComputationReceipt.prototype, 'add')
    const observe = async (read: TypeScriptSemanticReader) => {
      executions++
      const evaluator = await read.values()
      const first = await evaluator.value(missing).resolve()
      expect(await evaluator.value(missing).resolve()).toEqual(first)
      expect(evaluator.canReuse(first)).toBe(true)
      return { kind: first.kind }
    }
    const reads = () => add.mock.calls.filter(([key]) => key === dependency).length
    try {
      const first = query('before'), next = query('later')
      cache.committed(first.generation)
      expect(await cache.run(first, async () => before, observe, null, () => {})).toEqual({ kind: 'unknown' })
      expect(reads()).toBe(1)
      await cache.run(first, async () => before, observe, null, () => {})
      expect(executions).toBe(1)
      cache.committed(next.generation)
      await cache.run(next, async () => later, observe, null, () => {})
      expect(executions).toBe(2)
      expect(reads()).toBe(2)
      // An old reader recomputes without replacing the current receipt.
      await cache.run(first, async () => before, observe, null, () => {})
      expect(executions).toBe(3)
      expect(reads()).toBe(2)
      await cache.run(next, async () => later, observe, null, () => {})
      expect(executions).toBe(3)
    } finally { cache.close(); values.close() }
  })

  it('reserves temporary tags with compaction and executes normally when that reservation cannot fit', async () => {
    const index = IndexedValues.empty().update([], [], true, capabilities), pinned = query('memory')
    for (const maximum of [COMPUTATION_RECEIPT_BYTES * 2, 8 * 1024 * 1024]) {
      const values = new ValueResolutionCache(Infinity, maximum), cache = new SemanticComputationCache(values)
      let executions = 0, constructionBytes = 0
      const baseline = values.bytes
      const observe = () => { executions++; constructionBytes = values.bytes - baseline; return { complete: true } }
      try {
        cache.committed(pinned.generation)
        await cache.run(pinned, async () => index, observe, null, () => {})
        await cache.run(pinned, async () => index, observe, null, () => {})
        if (maximum === 8 * 1024 * 1024) {
          expect(executions).toBe(1)
          expect(constructionBytes).toBeGreaterThanOrEqual(COMPUTATION_RECEIPT_BYTES * 2 + COMPUTATION_WITNESS_BYTES)
          // Retention contains the compact receipt and result, not the tag table.
          expect(values.bytes - baseline).toBeLessThan(COMPUTATION_WITNESS_BYTES)
        } else {
          expect(executions).toBe(2)
          expect(constructionBytes).toBe(0)
          expect(values.bytes).toBe(baseline)
        }
        expect(values.bytes).toBeLessThanOrEqual(maximum)
        cache.close()
        expect(values.bytes).toBe(baseline)
      } finally { cache.close(); values.close() }
    }
  })
})

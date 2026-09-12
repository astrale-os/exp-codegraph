import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveAnalysisId } from '../analysis/identity/index.ts'
import type { AnalysisQuery, CapabilityStatus } from '../analysis/query/index.ts'
import { SemanticComputationCache } from '../analysis/typescript/project/compute.ts'
import type { TypeScriptSemanticReader } from '../analysis/typescript/project/model.ts'
import { ValueResolutionCache, type ValueIndexRevision } from '../analysis/typescript/value/symbolic/cache.ts'
import { IndexedValues, type ValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'
import { ComputationReceipt } from '../analysis/typescript/value/symbolic/receipt.ts'

afterEach(() => vi.restoreAllMocks())

const capabilities = ['typescript.body', 'typescript.source'].map((capability) => ({
  capability, completeness: { kind: 'complete' },
})) as CapabilityStatus[]
const query = (id: string) => ({ generation: { id }, capabilities: async () => capabilities }) as unknown as AnalysisQuery
const occurrence = (name: string) => deriveAnalysisId('occurrence', 'computation-reconciliation', name)
const dependency = (name: string) => `occurrence:${occurrence(name)}`
const initial = () => IndexedValues.empty().update([], [], true, capabilities)
function revision(before: ValueIndex, changed: readonly string[], overrides: Partial<ValueIndexRevision> = {}): ValueIndex {
  return { ...before, dependency: before.dependency.bind(before), revision: {
    ...before.revision, token: {}, parent: before.revision.token, changed: new Set(changed), ...overrides,
  } }
}
async function missing(read: TypeScriptSemanticReader, name: string) {
  return (await (await read.values()).value(occurrence(name)).resolve()).kind
}

describe('semantic computation variant reconciliation', () => {
  it.each(['dependency', 'discontinuity', 'selection'] as const)(
    'releases an unrequested variant before reserving new work after a %s change', async (change) => {
      const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
      const before = initial(), first = query('before'), next = query('next')
      const after = revision(before, change === 'dependency' ? [dependency('changed')] : [],
        change === 'discontinuity' ? { parent: {} } : change === 'selection' ? { selection: undefined } : {})
      const proof = { kind: 'known' as const, value: 'independent', evidence: [],
        limits: { maximumSteps: 10, maximumDepth: 10, maximumAlternatives: 10 } }
      let executions = 0
      const payload = 'x'.repeat(4 * 1024 * 1024)
      const observe = async (read: TypeScriptSemanticReader, variant: string) => {
        executions++
        if (variant === 'new') expect(values.get('independent', () => true)).toBe(proof)
        return { variant, kind: await missing(read, 'changed'), payload }
      }
      try {
        cache.committed(first.generation)
        const old = await cache.run(first, async () => before, observe, 'old', () => {})
        values.put('independent', proof, 3 * 1024 * 1024)
        expect(values.get('independent', () => true)).toBe(proof)
        cache.committed(next.generation)
        const current = await cache.run(next, async () => after, observe, 'new', () => {})
        expect(current).toEqual({ ...old, variant: 'new' })
        expect(values.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
        expect(values.get('independent', () => true)).toBe(proof)
        // Old pins still execute, but cannot retire or replace the current entry.
        expect(await cache.run(first, async () => before, observe, 'old', () => {})).toEqual(old)
        expect(await cache.run(next, async () => after, observe, 'new', () => {})).toEqual(current)
        expect(executions).toBe(3)
      } finally { cache.close(); values.close() }
    },
  )

  it('keeps undemanded valid variants through successive deltas and reconciles only once per token', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const before = initial(), second = revision(before, ['unrelated:one']), third = revision(second, ['unrelated:two'])
    const first = query('first'), next = query('second'), last = query('third')
    const executions: string[] = []
    const observe = async (read: TypeScriptSemanticReader, name: string) => {
      executions.push(name)
      return { name, kind: await missing(read, name) }
    }
    const intersects = vi.spyOn(ComputationReceipt.prototype, 'intersects')
    try {
      cache.committed(first.generation)
      const a = await cache.run(first, async () => before, observe, 'a', () => {})
      const b = await cache.run(first, async () => before, observe, 'b', () => {})
      cache.committed(next.generation)
      expect(await cache.run(next, async () => second, observe, 'a', () => {})).toEqual(a)
      const comparisons = intersects.mock.calls.length
      for (let index = 0; index < 3; index++) await cache.run(next, async () => second, observe, 'a', () => {})
      expect(intersects.mock.calls.length).toBe(comparisons)
      cache.committed(last.generation)
      expect(await cache.run(last, async () => third, observe, 'b', () => {})).toEqual(b)
      expect(executions).toEqual(['a', 'b'])
      expect(comparisons).toBe(2)
      expect(intersects.mock.calls.length).toBe(comparisons + 2)
      // Looking at an old pin must not move the reconciliation frontier backward.
      expect(await cache.run(first, async () => before, observe, 'a', () => {})).toEqual(a)
      expect(await cache.run(last, async () => third, observe, 'a', () => {})).toEqual(a)
      expect(executions).toEqual(['a', 'b', 'a'])
      expect(intersects.mock.calls.length).toBe(comparisons + 2)
    } finally { cache.close(); values.close() }
  })

  it('does not publish an old completion after reentering a newer revision from its callback', async () => {
    const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
    const before = initial(), after = revision(before, [dependency('changed')])
    const first = query('before'), next = query('after')
    const executions: string[] = []
    const observe = async (read: TypeScriptSemanticReader, name: string): Promise<{ name: string; kind: string }> => {
      executions.push(name)
      const kind = await missing(read, 'changed')
      if (name === 'outer') {
        cache.committed(next.generation)
        expect(await cache.run(next, async () => after, observe, 'inner', () => {})).toEqual({ name: 'inner', kind })
      }
      return { name, kind }
    }
    try {
      cache.committed(first.generation)
      expect(await cache.run(first, async () => before, observe, 'outer', () => {})).toEqual({ name: 'outer', kind: 'unknown' })
      expect(await cache.run(next, async () => after, observe, 'inner', () => {})).toEqual({ name: 'inner', kind: 'unknown' })
      expect(executions).toEqual(['outer', 'inner'])
      expect(values.bytes).toBeLessThanOrEqual(8 * 1024 * 1024)
      cache.close()
      expect(values.bytes).toBeLessThan(64 * 1024)
    } finally { cache.close(); values.close() }
  })
})

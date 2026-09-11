import { expect, it } from 'vitest'
import type { AnalysisQuery, CapabilityStatus } from '../analysis/query/index.ts'
import { SemanticComputationCache } from '../analysis/typescript/project/compute.ts'
import { ValueResolutionCache } from '../analysis/typescript/value/symbolic/cache.ts'
import { IndexedValues, type ValueIndex } from '../analysis/typescript/value/symbolic/facts.ts'
import type { TypeScriptSemanticReader } from '../analysis/typescript/project/model.ts'

it('does not promote a result across a delta that cannot certify selection completeness', async () => {
  const capabilities = ['typescript.source', 'typescript.body'].map((capability) => ({
    capability, completeness: { kind: 'complete' },
  })) as CapabilityStatus[]
  // This private cache seam exercises a future/unknown index provider. The
  // resident project currently always supplies capabilities with its journal.
  const query = (id: string, capabilities: readonly CapabilityStatus[]) => ({
    generation: { id }, capabilities: async () => capabilities,
  }) as unknown as AnalysisQuery
  const before = IndexedValues.empty().update([], [], true, capabilities)
  const after: ValueIndex = { ...before, dependency: before.dependency.bind(before),
    revision: { token: {}, parent: before.revision.token, changed: new Set() } }
  const values = new ValueResolutionCache(), cache = new SemanticComputationCache(values)
  let executions = 0
  const observe = async (read: TypeScriptSemanticReader) => {
    executions++
    return (await read.calls({ paths: [] })).completeness
  }
  try {
    const first = query('before', capabilities)
    cache.committed(first.generation)
    expect(await cache.run(first, async () => before, observe, null, () => {})).toEqual({ kind: 'complete' })
    const second = query('after', [])
    cache.committed(second.generation)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await cache.run(second, async () => after, observe, null, () => {})).toMatchObject({ kind: 'unavailable' })
    }
    expect(executions).toBe(3)
  } finally { cache.close(); values.close() }
})

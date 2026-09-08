import { describe, expect, it, vi } from 'vitest'
import { generationIdentity, type AnalysisGeneration } from '../analysis/generation/index.ts'
import type { FactShardReference } from '../analysis/facts/index.ts'
import { deriveAnalysisId } from '../analysis/identity/index.ts'

const generation = {
  universe: deriveAnalysisId('project-universe', 'test', 'root'),
  producer: { id: deriveAnalysisId('producer', 'test', 'producer'), name: 'test', version: '1', protocolVersion: 1 },
  sourceManifest: deriveAnalysisId('source-manifest', 'test', 'sources'),
  capabilities: ['z', 'a', 'a'],
}
function reference(index: number): FactShardReference {
  return { key: deriveAnalysisId('fact-shard-key', 'test', index),
    digest: deriveAnalysisId('fact-shard-digest', 'test', index), namespace: `test.\u2028😀/${index}`,
    schemaVersion: 1, facts: index }
}
function original(metadata: Omit<AnalysisGeneration, 'id' | 'sequence'>, manifest: readonly FactShardReference[]) {
  return deriveAnalysisId('generation', 'astrale.analysis.generation.v1', {
    universe: metadata.universe, producer: metadata.producer, sourceManifest: metadata.sourceManifest,
    capabilities: [...new Set(metadata.capabilities)].sort(),
    manifest: [...manifest].sort((left, right) => left.key.localeCompare(right.key)),
  })
}

describe('streamed generation identity', () => {
  it('canonicalizes only newly observed immutable references on successive identities', () => {
    const references = Array.from({ length: 1024 }, (_, index) => Object.freeze(reference(10000 + index)))
    const changed = Object.freeze(reference(20000))
    const observed = new Set<object>([...references, changed])
    const entries = Object.entries
    let canonicalized = 0
    const spy = vi.spyOn(Object, 'entries').mockImplementation((value: object) => {
      if (observed.has(value)) canonicalized++
      return entries(value)
    })
    try {
      generationIdentity(generation, references)
      expect(canonicalized).toBe(1024)
      generationIdentity(generation, [...references])
      expect(canonicalized).toBe(1024)
      generationIdentity(generation, [changed, ...references.slice(1)])
      expect(canonicalized).toBe(1025)
    } finally { spy.mockRestore() }
  })

  it('preserves the v1 preimage through chunk boundaries, order changes and retained references', () => {
    const references = Array.from({ length: 2048 }, (_, index) => Object.freeze(reference(index)))
    for (const manifest of [[], references.slice(0, 1), references, [...references].reverse(),
      [Object.freeze(reference(4000)), ...references.slice(1)]]) {
      const expected = original(generation, manifest)
      expect(generationIdentity(generation, manifest)).toBe(expected)
      expect(generationIdentity(generation, manifest)).toBe(expected)
    }
    expect(generation.capabilities).toEqual(['z', 'a', 'a'])
  })

  it('keeps extra scalar fields and follows changes to mutable or nested custom references', () => {
    const flat = Object.freeze({ ...reference(1), extra: '\\u2028\u2029', absent: undefined, integer: 10n })
    const mutable = { ...reference(2), extra: 'old' }
    const nested = Object.freeze({ ...reference(3), extra: { value: 'old' } })
    const values = [flat, mutable, nested]
    expect(generationIdentity(generation, values)).toBe(original(generation, values))
    mutable.extra = 'new'; nested.extra.value = 'new'
    expect(generationIdentity(generation, values)).toBe(original(generation, values))
    expect(Object.isFrozen(mutable)).toBe(false)
    expect(Object.isFrozen(nested.extra)).toBe(false)
    expect(generationIdentity(generation, [flat])).toBe(original(generation, [flat]))
    expect(generationIdentity(generation, [flat])).toBe(original(generation, [flat]))
  })

  it('preserves custom accessor observations and nested toJSON key semantics', () => {
    const observations: string[] = []
    const custom = Object.freeze({ ...reference(0), get extra() { observations.push('read'); return observations.length } })
    const first = generationIdentity(generation, [custom])
    expect(observations).toEqual(['read'])
    observations.length = 0
    expect(first).toBe(original(generation, [custom]))
    const encoded = Object.freeze({ ...reference(1), toJSON(key: string) { return { observedKey: key } } })
    expect(generationIdentity(generation, [encoded])).toBe(original(generation, [encoded]))
    const producer = { ...generation.producer, toJSON(key: string) { return { observedKey: key } } }
    expect(generationIdentity({ ...generation, producer }, [reference(2)]))
      .toBe(original({ ...generation, producer }, [reference(2)]))
  })
})

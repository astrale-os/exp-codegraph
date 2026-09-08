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
  it.each([false, true])('canonicalizes only new immutable references (capabilities: %s)', (capabilities) => {
    const immutable = (index: number) => Object.freeze({ ...reference(index),
      ...(capabilities ? { capabilities: Object.freeze(['fixture.semantic']) } : {}) })
    const references = Array.from({ length: 1024 }, (_, index) => immutable(10000 + index))
    const changed = immutable(20000)
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
      canonicalized = 0
      generationIdentity(generation, [...references])
      expect(canonicalized).toBe(0)
      generationIdentity(generation, [changed, ...references.slice(1)])
      expect(canonicalized).toBe(1)
    } finally { spy.mockRestore() }
  })

  it('preserves the v1 preimage through chunk boundaries, order changes and retained references', () => {
    const references = Array.from({ length: 2048 }, (_, index) => Object.freeze({ ...reference(index),
      ...(index % 3 ? { capabilities: Object.freeze(index % 2 ? ['z', '\u2028😀', 'a', 'a'] : []) } : {}) }))
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

  it('does not certify a mutable reference, mutable capabilities or nested elements', () => {
    const mutable = { ...reference(30), capabilities: Object.freeze(['old']) }
    const capabilities = ['old']
    const shallow = Object.freeze({ ...reference(31), capabilities })
    const nested = { value: 'old' }
    const custom = Object.freeze({ ...reference(32), capabilities: Object.freeze([nested]) }) as unknown as FactShardReference
    const values = [mutable, shallow, custom]
    for (const value of values) {
      expect(generationIdentity(generation, [value])).toBe(original(generation, [value]))
      expect(generationIdentity(generation, [value])).toBe(original(generation, [value]))
    }
    mutable.capabilities = Object.freeze(['new'])
    capabilities.push('new')
    nested.value = 'new'
    for (const value of values) expect(generationIdentity(generation, [value])).toBe(original(generation, [value]))
    expect(Object.isFrozen(mutable)).toBe(false)
    expect(Object.isFrozen(capabilities)).toBe(false)
    expect(Object.isFrozen(nested)).toBe(false)
  })

  it('retains v1 scalar-array encoding even for values outside the capability string contract', () => {
    for (const capabilities of [[], ['fixture.semantic', undefined, null, false, 0, -0, NaN, Infinity, Symbol('x')], [1n]]) {
      const value = Object.freeze({ ...reference(35), capabilities: Object.freeze(capabilities) }) as unknown as FactShardReference
      expect(generationIdentity(generation, [value])).toBe(original(generation, [value]))
      expect(generationIdentity(generation, [value])).toBe(original(generation, [value]))
    }
  })

  it.each(['getter', 'proxy', 'map', 'constructor', 'subclass', 'toJSON', 'sparse'] as const)(
    'preserves generic canonicalization observations for a custom %s array', (kind) => {
      const observations: string[] = []
      let capabilities: string[] = ['fixture.semantic']
      if (kind === 'getter') Object.defineProperty(capabilities, '0', {
        enumerable: true, get() { observations.push('element'); return String(observations.length) },
      })
      if (kind === 'map') Object.defineProperty(capabilities, 'map', {
        value() { observations.push('map'); return ['custom-result'] },
      })
      if (kind === 'constructor') Object.defineProperty(capabilities, 'constructor', {
        get() {
          observations.push('constructor')
          return { get [Symbol.species]() { observations.push('species'); return Array } }
        },
      })
      if (kind === 'subclass') capabilities = new (class extends Array<string> {
        static get [Symbol.species]() { observations.push('species'); return Array }
      })('fixture.semantic')
      if (kind === 'toJSON') Object.defineProperty(capabilities, 'toJSON', {
        value(key: string) { observations.push(`toJSON:${key}`); return key },
      })
      if (kind === 'sparse') capabilities = new Array<string>(2)
      Object.freeze(capabilities)
      if (kind === 'proxy') capabilities = new Proxy(capabilities, {
        get(target, key, receiver) { observations.push(`get:${String(key)}`); return Reflect.get(target, key, receiver) },
        has(target, key) { observations.push(`has:${String(key)}`); return Reflect.has(target, key) },
        ownKeys(target) { observations.push('keys'); return Reflect.ownKeys(target) },
        getOwnPropertyDescriptor(target, key) {
          observations.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key)
        },
      })
      const manifest = [Object.freeze({ ...reference(40), capabilities })]
      const expected = original(generation, manifest)
      const expectedObservations = [...observations]
      for (let attempt = 0; attempt < 2; attempt++) {
        observations.length = 0
        expect(generationIdentity(generation, manifest)).toBe(expected)
        expect(observations).toEqual(expectedObservations)
      }
    },
  )

  it('keeps unknown fields and nonenumerable toJSON on the generic object-cloning path', () => {
    let calls = 0
    const custom = Object.freeze(Object.defineProperty({ ...reference(50),
      capabilities: Object.freeze(['fixture.semantic']), extra: 'unknown' }, 'toJSON', {
      value() { calls++; return 'not observed by canonical object cloning' },
    }))
    const entries = Object.entries
    let canonicalized = 0
    const spy = vi.spyOn(Object, 'entries').mockImplementation((value: object) => {
      if (value === custom) canonicalized++
      return entries(value)
    })
    try {
      const expected = original(generation, [custom])
      canonicalized = 0
      expect(generationIdentity(generation, [custom])).toBe(expected)
      expect(generationIdentity(generation, [custom])).toBe(expected)
      expect(canonicalized).toBe(2)
      expect(calls).toBe(0)
    } finally { spy.mockRestore() }
  })

  it.each(['map', 'constructor', 'species', 'array-toJSON', 'object-toJSON', 'iterator'] as const)(
    'falls back with the same observations when %s changes after a reference was cached', (kind) => {
      const observations: string[] = []
      const manifest = [Object.freeze({ ...reference(60), capabilities: Object.freeze(['fixture.semantic']) })]
      const baseline = original(generation, manifest)
      expect(generationIdentity(generation, manifest)).toBe(baseline)
      const target = kind === 'species' ? Array : kind === 'object-toJSON' ? Object.prototype : Array.prototype
      const key = kind === 'species' ? Symbol.species : kind === 'iterator' ? Symbol.iterator :
        kind.endsWith('toJSON') ? 'toJSON' : kind
      const previous = Object.getOwnPropertyDescriptor(target, key)
      const map = Array.prototype.map
      const iterator = Array.prototype[Symbol.iterator]
      let changed: PropertyDescriptor
      if (kind === 'map') changed = { value: function(this: unknown[], callback: (value: unknown) => unknown) {
        observations.push('map'); return map.call(this, callback)
      } }
      else if (kind === 'iterator') changed = { value: function(this: unknown[]) {
        observations.push('iterator'); return iterator.call(this)
      } }
      else if (kind.endsWith('toJSON')) changed = { value: function(key: string) {
        observations.push(`toJSON:${key}`); return { observedKey: key }
      } }
      else changed = { get() { observations.push(kind); return Array } }
      let expected: string, actual: string, expectedObservations: string, actualObservations: string
      Object.defineProperty(target, key, { configurable: true, ...changed })
      try {
        expected = original(generation, manifest)
        expectedObservations = observations.join('|')
        observations.length = 0
        actual = generationIdentity(generation, manifest)
        actualObservations = observations.join('|')
      } finally {
        if (previous) Object.defineProperty(target, key, previous)
        else Reflect.deleteProperty(target, key)
      }
      expect(actual!).toBe(expected!)
      expect(actualObservations!).toBe(expectedObservations!)
      expect(generationIdentity(generation, manifest)).toBe(baseline)
    },
  )

  it.each(['map', 'toJSON'])('does not certify an already customized array %s at module initialization', async (key) => {
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, key)
    const map = Array.prototype.map
    let calls = 0
    Object.defineProperty(Array.prototype, key, { configurable: true, ...previous,
      value: key === 'map' ? function(this: unknown[], callback: (value: unknown) => unknown, thisArg?: unknown) {
        calls++; return map.call(this, callback, thisArg)
      } : function(key: string) { calls++; return { observedKey: key } },
    })
    let actual: string, expected: string, actualCalls: number, expectedCalls: number
    try {
      vi.resetModules()
      const { hashGenerationIdentity } = await import('../analysis/generation/identity.ts')
      const manifest = [Object.freeze({ ...reference(70), capabilities: Object.freeze(['fixture.semantic']) })]
      calls = 0
      expected = original(generation, manifest)
      expectedCalls = calls
      hashGenerationIdentity(generation, manifest)
      calls = 0
      actual = hashGenerationIdentity(generation, manifest)
      actualCalls = calls
    } finally {
      if (previous) Object.defineProperty(Array.prototype, key, previous)
      else Reflect.deleteProperty(Array.prototype, key)
    }
    expect(actual!).toBe(expected!)
    expect(actualCalls!).toBe(expectedCalls!)
  })
})

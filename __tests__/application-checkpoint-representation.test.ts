import { describe, expect, it } from 'vitest'

import type { ApiModelV2, ApiSource, ApiToken } from '../api/model.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'
import {
  packSpecificationSnapshot,
  type ApiPayloadStore,
  type PackedSpecificationSnapshot,
  unpackSpecificationSnapshot,
} from '../application/checkpoint/representation.ts'
import { canonicalJson, sha256 } from '../workspace/checkpoint/validation.ts'

describe('application checkpoint specification representation', () => {
  it('round-trips API, internal, and port models without semantic drift', () => {
    const snapshot = specification([
      model('api.d.ts', [source('api.d.ts')], [token('api.d.ts', 'api')]),
      model('internal.d.ts', [source('internal.d.ts')], [token('internal.d.ts', 'internal')]),
      model('port.d.ts', [source('port.d.ts')], [token('port.d.ts', 'port')]),
    ])
    const payloads: ApiPayloadStore = new Map()

    const packed = packSpecificationSnapshot(snapshot, payloads)
    const restored = unpackSpecificationSnapshot(packed, payloads)

    expect(restored).toEqual(snapshot)
    expect(packed.module.api?.model).not.toHaveProperty('sources')
    expect(packed.module.api?.model).not.toHaveProperty('tokens')
  })

  it('deduplicates identical source/token payloads across API models', () => {
    const sharedSource = source('shared.d.ts')
    const sharedTokens = [token('shared.d.ts', 'shared')]
    const snapshot = specification([
      model('api.d.ts', [sharedSource], sharedTokens),
      model('internal.d.ts', [sharedSource], sharedTokens),
      model('port.d.ts', [sharedSource], sharedTokens),
    ])
    const payloads: ApiPayloadStore = new Map()

    packSpecificationSnapshot(snapshot, payloads)

    expect(payloads).toHaveLength(1)
    const [key, payload] = [...payloads.entries()][0]!
    expect(key).toBe(sha256(Buffer.from(canonicalJson(payload), 'utf8')))
  })

  it('stores and restores interleaved token order with source indexes', () => {
    const snapshot = specification([
      model(
        'api.d.ts',
        [source('a.d.ts'), source('b.d.ts')],
        [token('a.d.ts', 'a1'), token('b.d.ts', 'b1'), token('a.d.ts', 'a2')],
      ),
    ])
    const payloads: ApiPayloadStore = new Map()
    const packed = packSpecificationSnapshot(snapshot, payloads)
    const packedModel = packed.module.api?.model

    expect(packedModel?.tokenSourceIndexes).toEqual([0, 1, 0])
    expect(unpackSpecificationSnapshot(packed, payloads)).toEqual(snapshot)
  })

  it('rejects missing, duplicate, and colliding payload references', () => {
    const snapshot = specification([
      model('api.d.ts', [source('api.d.ts')], [token('api.d.ts', 'api')]),
    ])
    const payloads: ApiPayloadStore = new Map()
    const packed = packSpecificationSnapshot(snapshot, payloads)
    const key = packed.module.api!.model!.sourceKeys[0]!

    const missing = new Map(payloads)
    missing.delete(key)
    expect(() => unpackSpecificationSnapshot(packed, missing)).toThrow(/missing/u)

    const duplicate = {
      ...packed,
      module: {
        ...packed.module,
        api: {
          ...packed.module.api!,
          model: {
            ...packed.module.api!.model!,
            sourceKeys: [key, key],
          },
        },
      },
    } as PackedSpecificationSnapshot
    expect(() => unpackSpecificationSnapshot(duplicate, payloads)).toThrow(/repeats payload key/u)

    const collision = new Map(payloads)
    collision.set(key, {
      source: source('different.d.ts'),
      tokens: [token('different.d.ts', 'different')],
    })
    expect(() => packSpecificationSnapshot(snapshot, collision)).toThrow(/digest collision/u)
  })
})

function specification(models: readonly ApiModelV2[]): SpecificationSnapshot {
  const api = resource('api.d.ts', models[0])
  const internal = models[1] ? resource('internal.d.ts', models[1]) : undefined
  const port = models[2]
    ? {
        ...resource('port.d.ts', models[2]),
        declarationPointer: '/port',
        port: { name: 'Port', declaration: 'Port' },
      }
    : undefined
  return {
    format: 'astrale.typespec.specification',
    version: 2,
    id: 'specification:representation',
    revision: 'revision',
    source: 'module/.spec/api.d.ts',
    title: 'Representation',
    root: 'module',
    module: {
      id: 'module/.spec/api.d.ts',
      name: 'Representation',
      declarationPointer: '',
      api: api as never,
      ...(internal ? { internal: internal as never } : {}),
      ports: port ? [port as never] : [],
      packageAuthority: {
        source: 'module/.spec/api.d.ts',
        packages: [],
        packagePatterns: [],
      },
      packages: [],
    },
    schemas: [],
    examples: [],
    capabilities: [],
    flows: [],
    laws: [],
    states: [],
    benchmarks: [],
    packages: [],
    packagePatterns: [],
    sourceReferences: [],
    diagnostics: [],
  }
}

function model(name: string, sources: readonly ApiSource[], tokens: readonly ApiToken[]): ApiModelV2 {
  return {
    format: 'astrale.api',
    version: 2,
    entrypoint: name,
    fingerprint: `${name}:fingerprint`,
    sourceRevision: `${name}:revision`,
    dependencies: [],
    sources,
    surface: {} as never,
    metadata: {},
    tokens,
  }
}

function resource(source: string, model?: ApiModelV2): Record<string, unknown> {
  return {
    ref: `./${source}`,
    source,
    text: '',
    revision: source,
    ...(model ? { model } : {}),
  }
}

function source(file: string): ApiSource {
  return { file, revision: `${file}:revision`, text: `declare ${file}` }
}

function token(file: string, text: string): ApiToken {
  return { file, from: 0, to: text.length, text }
}

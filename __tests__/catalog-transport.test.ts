import { describe, expect, it } from 'vitest'

import type { ApiModel } from '../api/model.ts'
import type { ViewerSpecification } from '../viewer-host/specification.ts'

import {
  createCatalogSnapshot,
  restoreCatalogSnapshotVerifications,
  updateCatalogSnapshot,
} from '../server/catalog-snapshot.ts'
import { CatalogSnapshotStore } from '../server/catalog-store.ts'

describe('browser catalog transport', () => {
  it('deduplicates shared declaration sources without merging Spec payloads', () => {
    const model = apiModel('string', 'source-one')
    const alpha = specification('alpha/.spec/api.d.ts', 'Alpha', model)
    const beta = specification('beta/.spec/api.d.ts', 'Beta', model)
    const snapshot = createCatalogSnapshot({ specs: [alpha, beta], diagnostics: [] }, {})

    expect(snapshot.index.specs).toHaveLength(2)
    expect(snapshot.specs).toHaveLength(2)
    expect(snapshot.sources).toHaveLength(1)
    expect(snapshot.indexModule).not.toContain('interface Shared')
    expect(snapshot.index.specs[0]?.revision).not.toBe(snapshot.index.specs[1]?.revision)
    expect(snapshot.index.specs[0]?.apiDeclarationIdentities).toEqual([
      'shared/.spec/shared.d.ts:interface:Shared',
    ])
    expect(snapshot.index.specs[1]?.apiDeclarationIdentities).toBeUndefined()
  })

  it('publishes a dependency-wide generation atomically and retains exact old payloads', () => {
    const initial = createCatalogSnapshot(
      {
        specs: [
          specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('string', 'source-one')),
          specification('beta/.spec/api.d.ts', 'Beta', apiModel('string', 'source-one')),
        ],
        diagnostics: [],
      },
      {},
    )
    const changed = createCatalogSnapshot(
      {
        specs: [
          specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('number', 'source-two')),
          specification('beta/.spec/api.d.ts', 'Beta', apiModel('number', 'source-two')),
        ],
        diagnostics: [],
      },
      {},
    )
    const store = new CatalogSnapshotStore()
    store.publish(initial)
    const publication = store.publish(changed)

    expect(publication).toMatchObject({
      changed: true,
      generation: changed.index.generation,
      changedSpecs: ['alpha/.spec/api.d.ts', 'beta/.spec/api.d.ts'],
      removedSpecs: [],
    })
    for (const entry of initial.index.specs) {
      expect(store.spec(entry.source, entry.revision)).toBeDefined()
    }
    for (const key of initial.sources.keys()) expect(store.source(key)).toBeDefined()
  })

  it('projects compiled cross-spec contract imports into the compact index', () => {
    const alpha = specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('string', 'alpha'))
    const beta = specification('beta/.spec/api.d.ts', 'Beta', apiModel('string', 'beta'))
    alpha.modules[0]!.contract = expectedContract(alpha.source, [
      declarationIdentity(beta.source, 'First'),
      declarationIdentity(beta.source, 'Second'),
    ])
    beta.modules[0]!.contract = expectedContract(beta.source, [])

    const snapshot = createCatalogSnapshot({ specs: [beta, alpha], diagnostics: [] }, {})

    expect(snapshot.index.specs.find(({ source }) => source === alpha.source)?.contractDependencies)
      .toEqual([{ source: beta.source, declarations: 2 }])
    expect(
      snapshot.index.specs.find(({ source }) => source === beta.source)?.contractDependencies,
    ).toBeUndefined()
  })

  it('reuses unchanged immutable payloads across application snapshots', () => {
    const alpha = specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('string', 'alpha'))
    const first = createCatalogSnapshot(
      { specs: [alpha], diagnostics: [] },
      {},
      `application:${'1'.repeat(64)}`,
    )
    const second = createCatalogSnapshot(
      { specs: [alpha], diagnostics: [] },
      {},
      `application:${'2'.repeat(64)}`,
      first,
    )
    const firstEntry = first.index.specs[0]!
    const secondEntry = second.index.specs[0]!
    const firstPayload = first.specs.get(`${firstEntry.source}\0${firstEntry.revision}`)!
    const secondPayload = second.specs.get(`${secondEntry.source}\0${secondEntry.revision}`)!

    expect(secondPayload.spec).toBe(firstPayload.spec)
    expect(secondPayload).toBe(firstPayload)
    expect(secondPayload.revision).toBe(firstPayload.revision)
    expect(second.index.snapshot).not.toBe(first.index.snapshot)
  })

  it('patches one restored Spec exactly without hydrating unchanged payloads', () => {
    const alpha = specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('string', 'alpha'))
    const beta = specification('beta/.spec/api.d.ts', 'Beta', apiModel('number', 'beta'))
    const first = createCatalogSnapshot(
      { specs: [alpha, beta], diagnostics: [] },
      {},
      `application:${'1'.repeat(64)}`,
    )
    let unchangedPayloadReads = 0
    const restored = {
      ...first,
      inputs: new Map(),
      specs: countingMap(first.specs, (key) => {
        if (key.startsWith(`${beta.source}\0`)) unchangedPayloadReads++
      }),
    }
    const changedAlpha = { ...alpha, title: 'Alpha next' }
    const patched = updateCatalogSnapshot(
      restored,
      [changedAlpha],
      [alpha.source, beta.source],
      [],
      {},
      `application:${'2'.repeat(64)}`,
    )
    const cold = createCatalogSnapshot(
      { specs: [changedAlpha, beta], diagnostics: [] },
      {},
      `application:${'2'.repeat(64)}`,
    )

    expect(patched?.index).toEqual(cold.index)
    expect(patched?.projection).toEqual(cold.projection)
    expect([...patched!.specs.keys()].sort()).toEqual([...cold.specs.keys()].sort())
    expect([...patched!.sources.keys()].sort()).toEqual([...cold.sources.keys()].sort())
    expect(unchangedPayloadReads).toBe(0)
    for (const key of cold.specs.keys()) expect(patched?.specs.get(key)).toEqual(cold.specs.get(key))
    for (const key of cold.sources.keys()) expect(patched?.sources.get(key)).toEqual(cold.sources.get(key))
    expect(patched?.index.specs.find((entry) => entry.source === beta.source)?.revision)
      .toBe(first.index.specs.find((entry) => entry.source === beta.source)?.revision)
  })

  it('falls back when a changed Spec alters global projection topology', () => {
    const alpha = specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('string', 'alpha'))
    const beta = specification('beta/.spec/api.d.ts', 'Beta', apiModel('number', 'beta'))
    const first = createCatalogSnapshot({ specs: [alpha, beta], diagnostics: [] }, {})
    const changedAlpha = structuredClone(alpha)
    changedAlpha.modules[0]!.contract = expectedContract(alpha.source, [
      declarationIdentity(beta.source, 'Shared'),
    ])

    expect(updateCatalogSnapshot(
      first,
      [changedAlpha],
      [alpha.source, beta.source],
      [],
      {},
      `application:${'2'.repeat(64)}`,
    )).toBeUndefined()
  })

  it('restores an exact verification without hydrating unrelated Spec payloads', () => {
    const alpha = specification('alpha/.spec/api.d.ts', 'Alpha', apiModel('string', 'alpha'))
    const beta = specification('beta/.spec/api.d.ts', 'Beta', apiModel('number', 'beta'))
    const initial = createCatalogSnapshot({ specs: [alpha, beta], diagnostics: [] }, {})
    let betaReads = 0
    const restored = {
      ...initial,
      specs: countingMap(initial.specs, (key) => {
        if (key.startsWith(`${beta.source}\0`)) betaReads++
      }),
    }
    const verification = {
      status: 'pass' as const,
      profiles: [],
      rules: [],
      dependencies: [],
      durationMs: 1,
    }
    const patched = restoreCatalogSnapshotVerifications(restored, [{
      source: alpha.source,
      revision: alpha.verificationRevision,
      verification,
    }], {})
    const entry = patched.index.specs.find((value) => value.source === alpha.source)!

    expect(patched.specs.get(`${alpha.source}\0${entry.revision}`)?.spec.verification).toEqual(verification)
    expect(entry.metrics.status).toBe('pass')
    expect(betaReads).toBe(0)
  })
})

function countingMap<Value>(
  source: ReadonlyMap<string, Value>,
  read: (key: string) => void,
): ReadonlyMap<string, Value> {
  return {
    size: source.size,
    get(key) {
      read(key)
      return source.get(key)
    },
    has: (key) => source.has(key),
    keys: () => source.keys(),
    values: () => source.values(),
    entries: () => source.entries(),
    forEach: (callback, thisArg) => source.forEach(callback, thisArg),
    [Symbol.iterator]: () => source[Symbol.iterator](),
  }
}

function expectedContract(
  source: string,
  imports: NonNullable<ViewerSpecification['modules'][number]['contract']>['imports'],
): NonNullable<ViewerSpecification['modules'][number]['contract']> {
  return {
    id: source,
    imports,
  }
}

function declarationIdentity(source: string, name: string) {
  return {
    key: `${source}#/api/${name}`,
    source,
    pointer: `/api/${name}`,
    kind: 'interface' as const,
    name,
  }
}

function specification(source: string, title: string, model: ApiModel): ViewerSpecification {
  const root = source.slice(0, -'/.spec/api.d.ts'.length)
  return {
    title,
    source,
    root,
    modules: [
      {
        id: source,
        name: title,
        declarationPointer: '',
        api: { ref: './api.d.ts', source, text: '', revision: title, model },
        ports: [],
        packages: [],
        diagnostics: [],
      },
    ],
    schemas: [],
    capabilities: [],
    flows: [],
    laws: [],
    states: [],
    examples: [],
    diagnostics: [],
    benchmarks: [],
    packages: [],
    packagePatterns: [],
    sourceReferences: [],
    history: [],
    historyDiagnostics: [],
    historyRevision: title,
    contracts: [],
    specRevision: title,
    verificationRevision: title,
  }
}

function apiModel(value: 'number' | 'string', revision: string): ApiModel {
  const file = 'shared/.spec/shared.d.ts'
  const identity = `${file}:interface:Shared`
  const text = `export interface Shared { readonly value: ${value} }\n`
  const location = { file, line: 1, column: 1 } as const
  return {
    format: 'astrale.api',
    version: 2,
    entrypoint: file,
    fingerprint: revision,
    sourceRevision: revision,
    dependencies: [{ file, revision }],
    sources: [{ file, revision, text }],
    surface: {
      exports: [
        {
          path: ['Shared'],
          name: 'Shared',
          declaration: identity,
          kind: 'interface',
          typeOnly: true,
          location,
        },
      ],
      declarations: [
        {
          identity,
          name: 'Shared',
          kind: 'interface',
          location,
          exportPaths: [['Shared']],
          referencedDeclarations: [],
          issues: [],
        },
      ],
      issues: [],
    },
    metadata: { [identity]: { conformance: 'exact', errors: [] } },
    tokens: [{ file, from: 17, to: 23, text: 'Shared', declaration: identity }],
  }
}

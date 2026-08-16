import { describe, expect, it } from 'vitest'

import type { ApiModel } from '../api/model.ts'
import type { ViewerSpecification } from '../viewer-host/specification.ts'

import { createCatalogSnapshot } from '../server/catalog-snapshot.ts'
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

  it('reuses unchanged packed payload structure across application snapshots', () => {
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
    expect(secondPayload.revision).toBe(firstPayload.revision)
    expect(secondPayload.snapshot).not.toBe(firstPayload.snapshot)
  })
})

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

import { describe, expect, it } from 'vitest'

import type { ApiModel } from '../api/model.ts'
import type { ModuleSourceReference } from '../specification/resource/index.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'
import {
  assertCanonicalRepositoryPath,
  computeSpecificationImpact,
  createSpecificationImpactIndex,
} from '../application/change/index.ts'

describe('application specification change impact index', () => {
  it('maps a local normative resource to its direct owner', () => {
    const snapshot = specification('local', {
      schemas: [resource('local/.spec/schemas/value.schema.json') as never],
    })
    const index = createSpecificationImpactIndex([snapshot])

    expect(index.impact('local/.spec/schemas/value.schema.json')).toMatchObject({
      directOwners: ['local/.spec/api.d.ts'],
      dependentOwners: [],
      refreshedOwners: ['local/.spec/api.d.ts'],
      completeness: 'exact',
      fallbackReasons: [],
    })
  })

  it('refreshes every schema owner when the shared schema catalog can change', () => {
    const index = createSpecificationImpactIndex([
      specification('left', {
        schemas: [resource('left/.spec/schemas/value.schema.json') as never],
      }),
      specification('right', {
        schemas: [resource('right/.spec/schemas/value.schema.json') as never],
      }),
    ])

    expect(index.impact('left/.spec/schemas/value.schema.json').refreshedOwners).toEqual([
      'left/.spec/api.d.ts',
      'right/.spec/api.d.ts',
    ])
    expect(index.impact('right/.spec/schemas/new.schema.json', { kind: 'add' }).refreshedOwners).toEqual([
      'left/.spec/api.d.ts',
      'right/.spec/api.d.ts',
    ])
  })

  it('indexes test evidence files as exact qualification inputs', () => {
    const snapshot = specification('evidence', {
      laws: [
        {
          ...resource('evidence/.spec/laws/value.ts'),
          kind: 'law',
          definitions: [
            {
              tests: [{ file: 'tests/value.test.ts', id: 'VALUE' }],
            },
          ],
        } as never,
      ],
    })

    expect(
      createSpecificationImpactIndex([snapshot]).impact('evidence/tests/value.test.ts'),
    ).toMatchObject({
      directOwners: ['evidence/.spec/api.d.ts'],
      refreshedOwners: ['evidence/.spec/api.d.ts'],
      completeness: 'exact',
    })
  })

  it('attributes a shared external declaration to both owning snapshots', () => {
    const sharedModel = apiModel({ sources: ['shared/types.d.ts'] })
    const left = specification('left', {
      module: { api: resource('left/.spec/api.d.ts', sharedModel) as never },
    })
    const right = specification('right', {
      module: { api: resource('right/.spec/api.d.ts', sharedModel) as never },
    })
    const index = createSpecificationImpactIndex([right, left])

    expect(index.lookup('shared/types.d.ts').directOwners).toEqual([
      'left/.spec/api.d.ts',
      'right/.spec/api.d.ts',
    ])
  })

  it('follows a barrel-like API target to dependent owners', () => {
    const provider = specification('provider', {
      module: {
        api: resource('provider/.spec/api.d.ts', apiModel({ sources: ['shared/barrel.d.ts'] })) as never,
      },
    })
    const consumer = specification('consumer', {
      references: [reference('consumer/.spec/api.d.ts', 'shared/barrel.d.ts')],
    })
    const index = createSpecificationImpactIndex([consumer, provider])

    expect(index.resolve('shared/barrel.d.ts')).toMatchObject({
      directOwners: ['provider/.spec/api.d.ts'],
      dependentOwners: ['consumer/.spec/api.d.ts'],
      refreshedOwners: ['consumer/.spec/api.d.ts', 'provider/.spec/api.d.ts'],
      completeness: 'exact',
    })
  })

  it('uses declaration dependencies as reverse edges to another owned input', () => {
    const provider = specification('provider-dependency', {
      module: {
        api: resource('provider-dependency/.spec/api.d.ts', apiModel({ sources: ['shared/decl.d.ts'] })) as never,
      },
    })
    const consumer = specification('consumer-dependency', {
      module: {
        api: resource(
          'consumer-dependency/.spec/api.d.ts',
          apiModel({ dependencies: ['shared/decl.d.ts'] }),
        ) as never,
      },
    })

    expect(createSpecificationImpactIndex([consumer, provider]).impact('shared/decl.d.ts')).toMatchObject({
      directOwners: ['provider-dependency/.spec/api.d.ts'],
      dependentOwners: ['consumer-dependency/.spec/api.d.ts'],
      refreshedOwners: [
        'consumer-dependency/.spec/api.d.ts',
        'provider-dependency/.spec/api.d.ts',
      ],
    })
  })

  it('indexes package authority and computes transitive dependents', () => {
    const authority = specification('authority', {
      packageAuthoritySource: 'authority/.spec/api.d.ts',
      packages: [resource('packages/acme.ts') as never],
    })
    const middle = specification('middle', {
      references: [reference('middle/.spec/api.d.ts', 'authority/.spec/api.d.ts')],
    })
    const leaf = specification('leaf', {
      references: [reference('leaf/.spec/api.d.ts', 'middle/.spec/api.d.ts')],
    })
    const index = createSpecificationImpactIndex([leaf, authority, middle])

    expect(index.impact('authority/.spec/api.d.ts')).toMatchObject({
      directOwners: ['authority/.spec/api.d.ts'],
      dependentOwners: ['leaf/.spec/api.d.ts', 'middle/.spec/api.d.ts'],
      refreshedOwners: [
        'authority/.spec/api.d.ts',
        'leaf/.spec/api.d.ts',
        'middle/.spec/api.d.ts',
      ],
    })
    expect(index.impact('packages/acme.ts').directOwners).toEqual([
      'authority/.spec/api.d.ts',
    ])
  })

  it('returns an exact empty impact for an unrelated ordinary path', () => {
    const result = computeSpecificationImpact([specification('module')], 'docs/notes.md')
    expect(result).toEqual({
      path: 'docs/notes.md',
      directOwners: [],
      dependentOwners: [],
      refreshedOwners: [],
      completeness: 'exact',
      fallbackReasons: [],
    })
  })

  it('widens source additions and deletions because the old reverse graph cannot contain them', () => {
    const index = createSpecificationImpactIndex([
      specification('left'),
      specification('right'),
    ])
    expect(index.impact('left/src/new.ts', { kind: 'add' })).toMatchObject({
      completeness: 'conservative-full',
      refreshedOwners: ['left/.spec/api.d.ts', 'right/.spec/api.d.ts'],
      fallbackReasons: ['topology-ambiguity'],
    })
    expect(index.impact('left/src/removed.ts', { kind: 'unlink' })).toMatchObject({
      completeness: 'conservative-full',
      fallbackReasons: ['topology-ambiguity'],
    })
  })

  it('attributes implementation and newly added layout inputs by their containing module root', () => {
    const index = createSpecificationImpactIndex([
      specification('parent'),
      specification('parent/child'),
    ])

    expect(index.impact('parent/src/private.ts', { kind: 'change' }).refreshedOwners).toEqual([
      'parent/.spec/api.d.ts',
    ])
    expect(index.impact('parent/child/.spec/laws/new.ts', { kind: 'add' }).refreshedOwners).toEqual([
      'parent/.spec/api.d.ts',
      'parent/child/.spec/api.d.ts',
    ])
  })

  it('rejects non-canonical paths instead of normalizing them', () => {
    for (const path of ['/outside/file.ts', './module/file.ts', 'module/../file.ts', 'module\\file.ts']) {
      expect(() => assertCanonicalRepositoryPath(path)).toThrow()
    }
  })

  it('falls back to the complete corpus for unknown declarations and configuration', () => {
    const index = createSpecificationImpactIndex([specification('left'), specification('right')])

    expect(index.impact('external/unknown.d.ts')).toMatchObject({
      completeness: 'conservative-full',
      refreshedOwners: ['left/.spec/api.d.ts', 'right/.spec/api.d.ts'],
      fallbackReasons: ['unknown-declaration'],
    })
    expect(index.impact('package.json').fallbackReasons).toEqual(['package-configuration'])
    expect(index.impact('tsconfig.base.json').fallbackReasons).toEqual([
      'typescript-configuration',
    ])
    expect(index.impact('docs/new.md', { kind: 'add' })).toMatchObject({
      completeness: 'exact',
      refreshedOwners: [],
      fallbackReasons: [],
    })
    expect(index.impact('docs/new.md', { kind: 'add', topologyAmbiguous: true })).toMatchObject({
      completeness: 'conservative-full',
      fallbackReasons: ['topology-ambiguity'],
    })
  })
})

interface SpecificationOverrides {
  readonly module?: Partial<SpecificationSnapshot['module']>
  readonly schemas?: readonly unknown[]
  readonly references?: readonly ModuleSourceReference[]
  readonly packages?: readonly unknown[]
  readonly laws?: readonly unknown[]
  readonly packageAuthoritySource?: string
}

function specification(name: string, overrides: SpecificationOverrides = {}): SpecificationSnapshot {
  const apiSource = `${name}/.spec/api.d.ts`
  const authoritySource = overrides.packageAuthoritySource ?? apiSource
  return {
    format: 'astrale.typespec.specification',
    version: 2,
    id: `specification:${name}`,
    revision: name,
    source: apiSource,
    title: name,
    root: name,
    module: {
      id: apiSource,
      name,
      declarationPointer: '',
      api: resource(apiSource) as never,
      ports: [],
      packageAuthority: {
        source: authoritySource,
        packages: [],
        packagePatterns: [],
      },
      packages: [],
      ...overrides.module,
    },
    schemas: (overrides.schemas ?? []) as never,
    examples: [],
    capabilities: [],
    flows: [],
    laws: (overrides.laws ?? []) as never,
    states: [],
    benchmarks: [],
    packages: (overrides.packages ?? []) as never,
    packagePatterns: [],
    sourceReferences: overrides.references ?? [],
    diagnostics: [],
  }
}

function resource(source: string, model?: ApiModel): Record<string, unknown> {
  return {
    ref: `./${source.split('/').at(-1)}`,
    source,
    text: '',
    revision: source,
    ...(model ? { model } : {}),
  }
}

function apiModel(options: {
  readonly sources?: readonly string[]
  readonly dependencies?: readonly string[]
} = {}): ApiModel {
  return {
    format: 'astrale.api',
    version: 2,
    entrypoint: 'api.d.ts',
    fingerprint: 'fingerprint',
    sourceRevision: 'source',
    sources: (options.sources ?? []).map((file) => ({ file, revision: file, text: '' })),
    dependencies: (options.dependencies ?? []).map((file) => ({ file, revision: file })),
    surface: {} as never,
    metadata: {},
    tokens: [],
  }
}

function reference(source: string, target: string): ModuleSourceReference {
  return {
    source,
    from: 0,
    to: 1,
    text: 'Barrel',
    target: { source: target, from: 0, line: 1, column: 1 },
  }
}

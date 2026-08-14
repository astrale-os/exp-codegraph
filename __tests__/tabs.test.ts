import { describe, expect, it } from 'vitest'

import type {
  ViewerSpecification,
  ViewerSpecificationModule,
} from '../viewer-host/specification.ts'

import {
  defaultSpecTab,
  diagnosticsTabState,
  moduleNavigationTab,
  selectedSpecTab,
  specTabs,
} from '../viewer/specification/tabs.ts'

describe('field-driven specification tabs', () => {
  it('exposes exactly one tab for each populated V2 projection field', () => {
    const current = spec({
      architecture: {} as ViewerSpecification['architecture'],
      modules: [
        module({
          api: {} as ViewerSpecificationModule['api'],
          ports: [{}] as unknown as ViewerSpecificationModule['ports'],
          binding: { project: 'tsconfig.json', root: 'src', entrypoint: 'src/index.ts' },
          packages: ['zod'],
        }),
      ],
      schemas: [{}] as unknown as ViewerSpecification['schemas'],
      examples: [{}] as unknown as ViewerSpecification['examples'],
      capabilities: [{}] as unknown as ViewerSpecification['capabilities'],
      flows: [{}] as unknown as ViewerSpecification['flows'],
      laws: [{}] as unknown as ViewerSpecification['laws'],
      states: [{}] as unknown as ViewerSpecification['states'],
      limits: {} as ViewerSpecification['limits'],
      layout: {} as ViewerSpecification['layout'],
      internal: {} as ViewerSpecification['internal'],
      packages: [{}] as unknown as ViewerSpecification['packages'],
      benchmarks: [{}] as unknown as ViewerSpecification['benchmarks'],
      history: [{}] as unknown as ViewerSpecification['history'],
    })

    expect(specTabs(current)).toEqual([
      'architecture',
      'api',
      'examples',
      'capabilities',
      'flows',
      'laws',
      'states',
      'limits',
      'layout',
      'ports',
      'internal',
      'code',
      'schemas',
      'packages',
      'benchmarks',
      'diagnostics',
      'history',
    ])
  })

  it('uses the first populated field and has no retired manifest tab', () => {
    const current = spec({
      modules: [module({ api: {} as ViewerSpecificationModule['api'] })],
    })
    expect(defaultSpecTab(current)).toBe('api')
    expect(defaultSpecTab(current, '/api')).toBe('api')
    expect(selectedSpecTab(current, { source: current.source, pointer: '/api' }, 'api')).toBe('api')
    expect(specTabs(current)).not.toContain('manifest')
  })

  it('restores available tabs and rejects unavailable route or remembered state', () => {
    const current = spec({ history: [{}] as unknown as ViewerSpecification['history'] })
    expect(selectedSpecTab(current, { source: 'beta/.spec/api.d.ts' }, 'history')).toBe('history')
    expect(selectedSpecTab(current, { source: current.source, tab: 'api' })).toBe('history')
  })

  it('carries the current section across modules before using destination memory', () => {
    expect(moduleNavigationTab('api', 'history', 'laws')).toBe('api')
    expect(moduleNavigationTab(undefined, 'history', 'laws')).toBe('history')
    expect(moduleNavigationTab(undefined, undefined, 'laws')).toBe('laws')
  })

  it('falls back to the destination saved tab when the carried section is unavailable', () => {
    const current = spec({
      modules: [module({ api: {} as ViewerSpecificationModule['api'] })],
    })

    expect(selectedSpecTab(current, { source: current.source, tab: 'history' }, 'api')).toBe('api')
  })

  it('falls back to diagnostics when no content field is populated', () => {
    const current = spec()
    expect(specTabs(current)).toEqual(['diagnostics'])
    expect(defaultSpecTab(current)).toBe('diagnostics')
  })

  it('exposes Code when catalog-derived topology exists without a root binding', () => {
    const current = spec()
    expect(specTabs(current)).not.toContain('code')
    expect(specTabs(current, { code: true })).toContain('code')
    expect(specTabs(current, { code: true })).not.toContain('architecture')
  })

  it('reports conformance separately from progressive identity-only proof strength', () => {
    const current = spec({
      modules: [module({ contract: { id: 'contract', imports: [] } })],
      verification: {
        status: 'pass',
        durationMs: 1,
        dependencies: [],
        rules: [{ id: 'surface', status: 'pass', diagnostics: [] }],
        profiles: [
          {
            id: 'surface',
            provider: 'astrale.typespec.module-surface',
            status: 'pass',
            rules: [{ id: 'surface', status: 'pass', diagnostics: [] }],
            evidence: {
              proof: {
                exactDeclarations: [],
                identityDeclarations: [{ id: 'GraphData', label: 'GraphData · value' }],
                unprovenObservations: [{ message: 'Shape was not evaluated.', severity: 'info' }],
              },
            },
          },
        ],
      },
    })

    expect(diagnosticsTabState(current)).toMatchObject({
      status: 'pass',
      label: 'conforms',
      identity: 1,
    })
  })

  it('gives failing diagnostics a red-state count', () => {
    const current = spec({
      diagnostics: [
        {
          code: 'SPEC_INVALID',
          message: 'Invalid specification.',
          file: 'alpha/.spec/api.d.ts',
          line: 1,
          column: 1,
        },
      ],
    })

    expect(diagnosticsTabState(current)).toMatchObject({ status: 'fail', label: '1' })
  })
})

function spec(overrides: Partial<ViewerSpecification> = {}): ViewerSpecification {
  return {
    title: 'Alpha',
    source: 'alpha/.spec/api.d.ts',
    root: 'alpha',
    modules: [],
    schemas: [],
    examples: [],
    diagnostics: [],
    specRevision: 'specification',
    verificationRevision: 'qualification',
    capabilities: [],
    flows: [],
    laws: [],
    states: [],
    benchmarks: [],
    packages: [],
    packagePatterns: [],
    sourceReferences: [],
    history: [],
    historyRevision: 'history',
    historyDiagnostics: [],
    contracts: [],
    ...overrides,
  }
}

function module(
  overrides: Partial<ViewerSpecificationModule> = {},
): ViewerSpecificationModule {
  return {
    id: 'alpha/.spec/api.d.ts',
    name: 'Alpha',
    declarationPointer: '',
    ports: [],
    packages: [],
    diagnostics: [],
    ...overrides,
  }
}

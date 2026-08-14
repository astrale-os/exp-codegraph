import { describe, expect, it } from 'vitest'

import type { ViewerQualification } from '../viewer-host/qualification.ts'

import { VerificationView } from '../viewer/logic/results.tsx'

describe('module verification viewer', () => {
  it('renders profiles, targets, both coverage directions, evidence, and source coordinates', () => {
    const view = VerificationView({ verification })
    const text = renderedText(view)

    expect(text).toContain('contract.module.surface')
    expect(text).toContain('astrale.typespec.module-surface')
    expect(text).toContain('Specification realization')
    expect(text).toContain('1 / 2')
    expect(text).toContain('Code documentation')
    expect(text).toContain('2 / 3')
    expect(text).toContain('Missing specified surface')
    expect(text).toContain('Undeclared code surface')
    expect(text).toContain('core/graph/index.ts:7:3')
    expect(text).toContain('core/graph/v1.ts')
    expect(text).toContain('Expected')
    expect(text).toContain('Actual')
    expect(text).toContain('Proof strength')
    expect(text).toContain('Identity-only')
    expect(text).toContain('Not evaluated')
    expect(text).toContain('TYPESCRIPT_GENERIC_UNSUPPORTED')
    expect(hrefs(view)).toContain('?spec=core%2Fgraph%2F.spec%2Fapi.d.ts&at=%2Fexports')
  })
})

const verification: ViewerQualification = {
  status: 'fail',
  durationMs: 12,
  dependencies: ['core/graph/index.ts'],
  profiles: [
    {
      id: 'contract.module.surface',
      provider: 'astrale.typespec.module-surface',
      status: 'fail',
      target: {
        id: 'source',
        adapter: 'typescript',
        project: 'core/tsconfig.json',
        root: 'core/graph',
        entrypoint: 'core/graph/index.ts',
        aliases: ['core/graph/v1.ts'],
      },
      coverage: {
        forward: {
          matched: 1,
          total: 2,
          percent: 50,
          unmatched: [
            {
              id: 'module.export.Graph.class',
              label: 'Graph is missing.',
              location: { file: 'core/graph/.spec/api.d.ts', pointer: '/exports' },
            },
          ],
        },
        inverse: {
          matched: 2,
          total: 3,
          percent: 66.67,
          unmatched: [
            {
              id: 'observed.export.Internal.value',
              label: 'Internal is undeclared.',
              location: { file: 'core/graph/index.ts', line: 7, column: 3 },
            },
          ],
        },
      },
      evidence: {
        observedModules: ['core.graph'],
        missingSurface: [
          {
            id: 'module.export.Graph.class',
            label: 'Graph is missing.',
            location: { file: 'core/graph/.spec/api.d.ts', pointer: '/exports' },
          },
        ],
        undeclaredSurface: [
          {
            id: 'observed.export.Internal.value',
            label: 'Internal is undeclared.',
            location: { file: 'core/graph/index.ts', line: 7, column: 3 },
          },
        ],
        outboundDependencies: [
          {
            id: 'dependency.core.graph.core.domain.runtime',
            source: 'core.graph',
            target: 'core.domain',
            kind: 'runtime',
            deep: false,
            location: { file: 'core/graph/index.ts', line: 7, column: 3 },
          },
        ],
        proof: {
          exactDeclarations: [
            {
              id: 'graph',
              label: 'Graph · class',
              location: { file: 'core/graph/.spec/api.d.ts', line: 1, column: 1 },
            },
          ],
          identityDeclarations: [
            {
              id: 'payload',
              label: 'Payload · interface',
              location: { file: 'core/graph/.spec/api.d.ts', line: 8, column: 1 },
            },
          ],
          unprovenObservations: [
            {
              code: 'TYPESCRIPT_GENERIC_UNSUPPORTED',
              message: 'Generic parameters are behind an identity-only declaration.',
              severity: 'info',
              location: { file: 'core/graph/index.ts', line: 12, column: 1 },
            },
          ],
        },
      },
      rules: [
        {
          id: 'module.export.Graph.class',
          status: 'fail',
          diagnostics: [
            {
              code: 'MODULE_EXPORT_MISSING',
              message: 'Graph is missing.',
              location: { file: 'core/graph/.spec/api.d.ts', pointer: '/exports' },
              related: [{ file: 'core/graph/index.ts', line: 7, column: 3 }],
              expected: 'Graph',
              actual: 'Internal',
            },
          ],
        },
      ],
    },
  ],
  rules: [
    {
      id: 'contract.module.surface/module.export.Graph.class',
      status: 'fail',
      diagnostics: [
        {
          code: 'MODULE_EXPORT_MISSING',
          message: 'Graph is missing.',
          location: { file: 'core/graph/.spec/api.d.ts', pointer: '/exports' },
        },
      ],
    },
  ],
}

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(renderedText).join(' ')
  if (!value || typeof value !== 'object') return ''
  const node = value as {
    readonly type?: unknown
    readonly props?: { readonly children?: unknown }
  }
  const props = node.props
  if (typeof node.type === 'function') {
    return renderedText((node.type as (props: unknown) => unknown)(props))
  }
  return props ? renderedText(props.children) : ''
}

function hrefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hrefs)
  if (!value || typeof value !== 'object') return []
  const node = value as {
    readonly type?: unknown
    readonly props?: { readonly href?: unknown; readonly children?: unknown }
  }
  const props = node.props
  if (!props) return []
  if (typeof node.type === 'function') {
    return hrefs((node.type as (props: unknown) => unknown)(props))
  }
  return [typeof props.href === 'string' ? props.href : [], hrefs(props.children)].flat(
    2,
  ) as string[]
}

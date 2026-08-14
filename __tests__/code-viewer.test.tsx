import { describe, expect, it } from 'vitest'

import type { ViewerCodeAnalysis as CodeAnalysis } from '../viewer-host/code.ts'

import { exitTargetSummary, fileExitTargets, moduleExitTargets } from '../viewer/code/exits.ts'
import { codeArea } from '../viewer/code/graph.tsx'
import { CodeView, hasImplementationDependencyGraph } from '../viewer/code/view.tsx'

describe('Code viewer', () => {
  it('renders scope, trustworthy metrics, architecture, reachability, and partial issues', () => {
    const text = renderedText(CodeView({ binding: analysis.scope, analysis }))

    expect(text).toContain('Observed source architecture')
    expect(text).toContain('Source files 12')
    expect(text).toContain('10 reachable · 2 detached')
    expect(text).toContain('Code lines 1,240')
    expect(text).not.toContain('CodeDependencyGraph')
    expect(text).toContain('Detached files')
    expect(text).toMatch(/root 2\s+files/)
    expect(text).toMatch(/\bexit\b/)
    expect(text).not.toMatch(/exit\s+1/)
    expect(text).toContain('CODE_DYNAMIC_IMPORT_UNRESOLVED')
  })

  it('derives stable presentation areas from source hierarchy', () => {
    expect(codeArea('.')).toBe('root')
    expect(codeArea('json')).toBe('json')
    expect(codeArea('v1/schema/value/profile')).toBe('v1/schema')
  })

  it('renders the physical graph only for observed cross-directory dependencies', () => {
    const internal = dependency('internal', 'query', false, 'runtime', false)
    expect(hasImplementationDependencyGraph(analysis)).toBe(false)
    expect(hasImplementationDependencyGraph({ ...analysis, dependencies: [internal] })).toBe(true)
    expect(
      renderedText(
        CodeView({
          binding: analysis.scope,
          analysis: { ...analysis, dependencies: [internal] },
        }),
      ),
    ).toContain('CodeDependencyGraph')
  })

  it('treats exits as unique architectural destinations outside the owned boundary', () => {
    const dependencies: CodeAnalysis['dependencies'] = [
      dependency('package-runtime', 'package:zod', false, 'runtime'),
      dependency('package-types', 'package:zod', true, 'type'),
      dependency('platform', 'platform:node:fs', false, 'runtime'),
      dependency('specification', 'spec:core/schema/.spec/api.d.ts', false, 'runtime'),
      dependency('internal', 'query', false, 'runtime', false),
      dependency('declaration', 'declaration:core/graph/types.d.ts', true, 'type'),
      dependency('unowned', 'unowned:shared/helper.ts', false, 'runtime'),
      dependency('unresolved', 'unresolved:missing', false, 'runtime'),
    ]

    const exits = fileExitTargets('core/graph/index.ts', dependencies)

    expect(exits).toEqual([
      {
        id: 'spec:core/schema/.spec/api.d.ts',
        kind: 'specification',
        label: 'core/schema/.spec/api.d.ts',
        usage: 'runtime',
      },
      {
        id: 'platform:node:fs',
        kind: 'platform',
        label: 'node:fs',
        usage: 'runtime',
      },
      {
        id: 'package:zod',
        kind: 'package',
        label: 'zod',
        usage: 'runtime-and-types',
      },
    ])
    expect(moduleExitTargets('.', dependencies)).toEqual(exits)
    expect(exitTargetSummary(exits)).toBe(
      'External destinations: core/schema/.spec/api.d.ts (specification, runtime), node:fs (platform, runtime), zod (package, runtime + types)',
    )
  })
})

function dependency(
  id: string,
  targetModule: string,
  typeOnly: boolean,
  kind: CodeAnalysis['dependencies'][number]['kind'],
  external = true,
): CodeAnalysis['dependencies'][number] {
  return {
    id,
    sourceFile: 'core/graph/index.ts',
    sourceModule: '.',
    targetModule,
    kind,
    typeOnly,
    specifier: targetModule,
    external,
    location: { file: 'core/graph/index.ts', line: 1, column: 1 },
  }
}

const analysis: CodeAnalysis = {
  status: 'partial',
  scope: {
    project: 'core/tsconfig.json',
    root: 'core/graph',
    entrypoint: 'core/graph/index.ts',
    aliases: [],
  },
  summary: {
    files: 12,
    reachableFiles: 10,
    detachedFiles: 2,
    modules: 3,
    lines: { total: 1800, code: 1240, comment: 310, blank: 250 },
    averageCodeLines: 103.3,
    medianCodeLines: 86,
    p95CodeLines: 240,
    largestFile: { path: 'core/graph/query/compile.ts', codeLines: 240 },
    internalDependencies: 17,
    externalDependencies: 2,
    runtimeCycles: 1,
    typeCycles: 0,
  },
  files: [
    {
      path: 'core/graph/index.ts',
      module: '.',
      entrypoint: true,
      reachable: true,
      lines: { total: 60, code: 40, comment: 10, blank: 10 },
      inbound: 0,
      outbound: 2,
    },
    {
      path: 'core/graph/detached.ts',
      module: '.',
      entrypoint: false,
      reachable: false,
      lines: { total: 20, code: 12, comment: 4, blank: 4 },
      inbound: 0,
      outbound: 0,
    },
  ],
  modules: [
    {
      id: '.',
      path: '.',
      files: 2,
      reachableFiles: 1,
      lines: { total: 80, code: 52, comment: 14, blank: 14 },
      inbound: 1,
      outbound: 1,
    },
  ],
  dependencies: [
    {
      id: 'external-zod',
      sourceFile: 'core/graph/index.ts',
      sourceModule: '.',
      targetModule: 'package:zod',
      kind: 'runtime',
      typeOnly: false,
      specifier: 'zod',
      external: true,
      location: { file: 'core/graph/index.ts', line: 2, column: 1 },
    },
  ],
  cycles: [],
  issues: [
    {
      code: 'CODE_DYNAMIC_IMPORT_UNRESOLVED',
      message: 'Computed dynamic import cannot establish its target.',
      location: { file: 'core/graph/index.ts', line: 8, column: 12 },
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
    if (node.type.name === 'CodeDependencyGraph') return 'CodeDependencyGraph'
    return renderedText((node.type as (props: unknown) => unknown)(props))
  }
  return props ? renderedText(props.children) : ''
}

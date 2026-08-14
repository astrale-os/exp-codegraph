import { describe, expect, it } from 'vitest'

import type { CatalogSpecEntry } from '../viewer-host/catalog.ts'

import { moduleTopologyMermaid } from '../viewer/specification/module-topology-diagram.ts'
import {
  buildModuleTopology,
  createModuleTopologyIndex,
  hasModuleTopology,
  immediateModuleChildren,
  moduleOwnerPath,
} from '../viewer/specification/module-topology-model.ts'

describe('module topology', () => {
  const index = createModuleTopologyIndex(entries)

  it('selects nearest specified children and keeps nested modules for drill-down', () => {
    expect(immediateModuleChildren(index, runtime.source).map(({ source }) => source)).toEqual([
      authentication.source,
      functions.source,
      schema.source,
    ])
    expect(hasModuleTopology(index, runtime.source)).toBe(true)
    expect(hasModuleTopology(index, functions.source)).toBe(false)
    expect(moduleOwnerPath('runtime/schema/.spec/api.d.ts')).toBe('runtime/schema')
    expect(moduleOwnerPath('legacy/query/.spec/api.d.ts')).toBe('legacy/query')
  })

  it('collapses declaration imports into bounded internal and family-context edges', () => {
    const topology = buildModuleTopology(index, runtime.source)!

    expect(topology.modules.map(({ label }) => label)).toEqual([
      'runtime',
      'authentication',
      'functions',
      'schema',
    ])
    expect(topology.composition).toHaveLength(3)
    expect(topology.dependencies).toEqual([
      { from: 'module_0', to: 'module_2', kind: 'scope', declarations: 2 },
      { from: 'module_0', to: 'module_3', kind: 'scope', declarations: 1 },
      { from: 'module_1', to: 'module_2', kind: 'contract', declarations: 1 },
    ])
    expect(topology.context.map(({ label, source }) => ({ label, source }))).toEqual([
      { label: 'ports', source: ports.source },
    ])
    expect(topology.contextDependencies).toEqual([
      { from: 'module_0', to: 'context_0', kind: 'context', declarations: 3 },
    ])
  })

  it('is deterministic for shuffled input and emits escaped, stable Mermaid', () => {
    const forward = buildModuleTopology(index, runtime.source)!
    const reversed = buildModuleTopology(
      createModuleTopologyIndex([...entries].reverse()),
      runtime.source,
    )!
    expect(reversed).toEqual(forward)

    const diagram = moduleTopologyMermaid(forward, 'dependencies', true)
    expect(diagram).toContain('subgraph module_scope["runtime"]')
    expect(diagram).toContain('module_0 -.-> module_2')
    expect(diagram).toContain('module_1 --> module_2')
    expect(diagram).toContain('module_0 -.->|3 declarations| context_0')
    expect(diagram).toContain('linkStyle 0,1,3 stroke-dasharray:4 4,opacity:0.48')
    expect(moduleTopologyMermaid(forward, 'composition', false)).toContain(
      'module_0 --- module_1',
    )
  })
})

const runtime = entry('runtime/.spec/api.d.ts', {
  dependencies: [
    ['runtime/functions/.spec/api.d.ts', 2],
    ['runtime/schema/registry/.spec/api.d.ts', 1],
    ['ports/functions/.spec/api.d.ts', 3],
  ],
})
const authentication = entry('runtime/authentication/.spec/api.d.ts', {
  dependencies: [
    ['runtime/authentication/credential/.spec/api.d.ts', 4],
    ['runtime/functions/.spec/api.d.ts', 1],
  ],
})
const credential = entry('runtime/authentication/credential/.spec/api.d.ts')
const functions = entry('runtime/functions/.spec/api.d.ts')
const schema = entry('runtime/schema/.spec/api.d.ts')
const registry = entry('runtime/schema/registry/.spec/api.d.ts')
const ports = entry('ports/.spec/api.d.ts')
const portsFunctions = entry('ports/functions/.spec/api.d.ts')
const entries = [
  runtime,
  authentication,
  credential,
  functions,
  schema,
  registry,
  ports,
  portsFunctions,
]

function entry(
  source: string,
  options: { dependencies?: readonly (readonly [string, number])[] } = {},
): CatalogSpecEntry {
  const owner = moduleOwnerPath(source)
  return {
    source,
    title: owner.split('/').at(-1) ?? owner,
    revision: source,
    metrics: { errors: 0, open: 0, status: 'pass' },
    ...(options.dependencies
      ? {
          contractDependencies: options.dependencies.map(([target, declarations]) => ({
            source: target,
            declarations,
          })),
        }
      : {}),
  }
}

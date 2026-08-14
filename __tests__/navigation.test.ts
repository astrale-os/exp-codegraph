import { describe, expect, it } from 'vitest'

import type { CatalogSpecEntry } from '../viewer-host/catalog.ts'
import type { NavigationNode } from '../viewer/shell/navigation-model.ts'

import {
  architectureIconPack,
  dependencyMermaid,
  systemFlowMermaid,
} from '../viewer/shell/architecture-diagram.ts'
import { architectureModuleHref } from '../viewer/shell/architecture.tsx'
import { isCatalogTransitionTarget } from '../viewer/shell/app.tsx'
import {
  buildNavigationTree,
  navigationCurrentIdentity,
  navigationExpansionKeys,
  navigationLocation,
} from '../viewer/shell/navigation-model.ts'
import {
  architectureRelationships,
  buildArchitectureLayers,
  buildNavigationFamilies,
  navigationBreadcrumb,
  navigationFamilyForSource,
  navigationFamilyModules,
} from '../viewer/shell/navigation-scope.ts'
import {
  addRecentNavigationSource,
  buildNavigationSearchIndex,
  parseNavigationSearchQuery,
  searchNavigationIndex,
  togglePinnedNavigationSource,
} from '../viewer/shell/navigation-search.ts'

describe('navigation tree', () => {
  it('turns hidden specification catalogs into meaningful source folders', () => {
    expect(navigationLocation('runtime/mutation/.spec/api.d.ts')).toEqual({
      folders: ['runtime', 'mutation'],
      sourceName: 'mutation',
    })
    expect(navigationLocation('ports/.spec/api.d.ts')).toEqual({
      folders: ['ports'],
      sourceName: 'ports',
    })
    expect(navigationLocation('core/auth/.spec/api.d.ts')).toEqual({
      folders: ['core', 'auth'],
      sourceName: 'auth',
    })
    expect(navigationLocation('alpha/.spec/api.d.ts')).toEqual({
      folders: ['alpha'],
      sourceName: 'alpha',
    })
    expect(navigationLocation('runtime/.spec/api.d.ts')).toEqual({
      folders: ['runtime'],
      sourceName: 'runtime',
    })
    expect(navigationExpansionKeys('core/graph/query/linear/.spec/api.d.ts')).toEqual([
      'core',
      'core/graph',
      'core/graph/query',
    ])
  })

  it('expands only true ancestors of an active module', () => {
    expect(navigationExpansionKeys('runtime/.spec/api.d.ts')).toEqual([])
    expect(navigationExpansionKeys('runtime/query/.spec/api.d.ts')).toEqual(['runtime'])
    expect(navigationExpansionKeys('core/auth/.spec/api.d.ts')).toEqual(['core'])
  })

  it('gives the current-module pin an owner-aware compact identity', () => {
    expect(
      navigationCurrentIdentity(
        'runtime/schema/transition/.spec/api.d.ts',
        'runtime.schema.transition',
      ),
    ).toEqual({
      name: 'transition',
      context: 'runtime / schema',
    })
    expect(navigationCurrentIdentity('ports/.spec/api.d.ts', 'ports')).toEqual({ name: 'ports' })
    expect(navigationCurrentIdentity('core/schema/laws/.spec/api.d.ts', 'Schema laws')).toEqual({
      name: 'laws',
      context: 'core / schema',
    })
  })

  it('groups specifications by source while keeping their canonical names at leaves', () => {
    const tree = buildNavigationTree([
      spec('core/schema/syscalls/.spec/api.d.ts', 'Kernel Syscalls'),
      spec('ports/.spec/api.d.ts', 'Kernel Capabilities'),
      spec('core/schema/semantics/.spec/api.d.ts', 'Kernel Semantics'),
      spec('core/auth/.spec/api.d.ts', 'Authentication'),
    ])

    expect(tree.specCount).toBe(4)
    expect(project(tree.nodes)).toEqual([
      {
        core: [
          { module: 'auth', spec: 'Authentication' },
          {
            schema: [
              { module: 'semantics', spec: 'Kernel Semantics' },
              { module: 'syscalls', spec: 'Kernel Syscalls' },
            ],
          },
        ],
      },
      { module: 'ports', spec: 'Kernel Capabilities' },
    ])
  })

  it('collapses only folders whose direct contents are exactly one specification', () => {
    const tree = buildNavigationTree([
      spec('core/domain/.spec/api.d.ts', 'Core Domain'),
      spec('runtime/schema/lifecycle/.spec/api.d.ts', 'Schema Lifecycle'),
    ])

    const core = folder(tree.nodes, 'core')
    expect(core.children[0]).toMatchObject({
      kind: 'module',
      name: 'domain',
      spec: { title: 'Core Domain' },
    })

    const runtime = folder(tree.nodes, 'runtime')
    expect(runtime.children).toHaveLength(1)
    expect(runtime.children[0]).toMatchObject({ kind: 'folder', name: 'schema' })
    const schema = folder(runtime.children, 'schema')
    expect(schema.children[0]).toMatchObject({ kind: 'module', name: 'lifecycle' })
    expect(runtime).toMatchObject({ kind: 'folder', name: 'runtime' })
  })

  it('recognizes a module that also owns nested capability modules', () => {
    const tree = buildNavigationTree([
      spec('runtime/.spec/api.d.ts', 'runtime'),
      spec('runtime/query/.spec/api.d.ts', 'runtime.query'),
      spec('runtime/mutation/.spec/api.d.ts', 'runtime.mutation'),
    ])

    const runtime = folder(tree.nodes, 'runtime')
    expect(runtime.module).toMatchObject({ title: 'runtime' })
    expect(runtime.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'module', name: 'query' }),
        expect.objectContaining({ kind: 'module', name: 'mutation' }),
      ]),
    )
    expect(runtime.children).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spec: { source: 'runtime/.spec/api.d.ts' } }),
      ]),
    )
    expect(runtime.specs.map(({ source }) => source)).toEqual([
      'runtime/.spec/api.d.ts',
      'runtime/mutation/.spec/api.d.ts',
      'runtime/query/.spec/api.d.ts',
    ])
  })

  it('searches canonical names and keeps same-titled sibling modules distinct by owner', () => {
    const specs = [
      spec('core/graph/query/linear/.spec/api.d.ts', 'capabilities'),
      spec('core/graph/query/relational/.spec/api.d.ts', 'capabilities'),
      spec('core/graph/mutate/strict-delta/.spec/api.d.ts', 'strict-delta'),
    ]

    const searched = buildNavigationTree(specs, 'query')
    expect(searched.specCount).toBe(2)
    const query = folder(folder(folder(searched.nodes, 'core').children, 'graph').children, 'query')
    const modules = query.children.filter((node) => node.kind === 'module')
    expect(modules.map((node) => node.name)).toEqual(['linear', 'relational'])
    expect(modules.map((node) => node.spec.title)).toEqual(['capabilities', 'capabilities'])
  })
})

describe('module switcher', () => {
  const specs = [
    spec('runtime/query/.spec/api.d.ts', 'runtime.query'),
    spec('query/archive/.spec/api.d.ts', 'query.archive'),
    spec('backend/engine/.spec/api.d.ts', 'backend.engine', {
      searchText: 'execution planner optimizer',
    }),
    spec('backend/functions/.spec/api.d.ts', 'backend.functions'),
    spec('core/schema/.spec/api.d.ts', 'core.schema', {
      status: 'error',
      declarations: ['Astrale.SchemaValidator'],
    }),
  ]
  const index = buildNavigationSearchIndex(specs)

  it('ranks exact names before path prefixes, aliases, fuzzy matches, then recency', () => {
    const query = searchNavigationIndex(index, 'query', ['query/archive/.spec/api.d.ts'])
    expect(query.items.map(({ entry }) => entry.spec.source).slice(0, 2)).toEqual([
      'runtime/query/.spec/api.d.ts',
      'query/archive/.spec/api.d.ts',
    ])
    expect(searchNavigationIndex(index, 'planner').items[0]?.entry.spec.source).toBe(
      'backend/engine/.spec/api.d.ts',
    )
    expect(searchNavigationIndex(index, 'engne').items[0]?.entry.spec.source).toBe(
      'backend/engine/.spec/api.d.ts',
    )
    expect(
      searchNavigationIndex(index, 'family:backend', [
        'backend/functions/.spec/api.d.ts',
        'backend/engine/.spec/api.d.ts',
      ]).items[0]?.entry.spec.source,
    ).toBe('backend/functions/.spec/api.d.ts')
  })

  it('combines free terms with family and status filters', () => {
    expect(searchNavigationIndex(index, 'runtime query').items[0]?.entry.spec.source).toBe(
      'runtime/query/.spec/api.d.ts',
    )
    expect(
      searchNavigationIndex(index, 'status:error').items.map(({ entry }) => entry.name),
    ).toEqual(['schema'])
    expect(searchNavigationIndex(index, 'family:backend engine').items[0]?.entry.name).toBe(
      'engine',
    )
    expect(parseNavigationSearchQuery('family:backend "execution planner"')).toEqual({
      terms: ['execution planner'],
      text: 'execution planner',
      families: ['backend'],
      statuses: [],
    })
  })

  it('resolves a trailing tab name as a destination without shadowing exact modules', () => {
    const sectionIndex = buildNavigationSearchIndex([
      spec('runtime/schema/.spec/api.d.ts', 'runtime.schema'),
      spec('runtime/context/.spec/api.d.ts', 'runtime.context'),
      spec('runtime/schema/bundle/.spec/api.d.ts', 'runtime.schema.bundle', {
        searchText: 'schema bundle',
      }),
    ])

    const natural = searchNavigationIndex(sectionIndex, 'runtime schema history')
    expect(natural.query).toMatchObject({ terms: ['runtime', 'schema'], tab: 'history' })
    expect(natural.items[0]?.entry.spec.source).toBe('runtime/schema/.spec/api.d.ts')
    expect(natural.items.map(({ direct }) => direct)).toEqual([true, false])

    const explicit = searchNavigationIndex(sectionIndex, 'runtime schema tab:history')
    expect(explicit.query).toMatchObject({ terms: ['runtime', 'schema'], tab: 'history' })
    expect(explicit.items[0]?.entry.spec.source).toBe('runtime/schema/.spec/api.d.ts')

    expect(searchNavigationIndex(sectionIndex, 'runtime schema ap').query).toMatchObject({
      terms: ['runtime', 'schema'],
      tab: 'api',
    })
    expect(searchNavigationIndex(sectionIndex, 'runtime schema arch').query.tab).toBe(
      'architecture',
    )
    expect(searchNavigationIndex(sectionIndex, 'runtime schema cont').query.tab).toBe('context')
    expect(searchNavigationIndex(sectionIndex, 'runtime schema la').query.tab).toBeUndefined()
    expect(parseNavigationSearchQuery('runtime schema section:arch').tab).toBe('architecture')

    const exactModule = searchNavigationIndex(sectionIndex, 'runtime context')
    expect(exactModule.query.tab).toBeUndefined()
    expect(exactModule.items[0]?.entry.spec.source).toBe('runtime/context/.spec/api.d.ts')
  })

  it('keeps recent and pinned source lists unique, ordered, and bounded', () => {
    expect(addRecentNavigationSource(['b', 'a', 'c'], 'a', 3)).toEqual(['a', 'b', 'c'])
    expect(addRecentNavigationSource(['b', 'c'], 'a', 2)).toEqual(['a', 'b'])
    expect(togglePinnedNavigationSource(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePinnedNavigationSource(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('scoped navigation', () => {
  const specs = [
    spec('core/.spec/api.d.ts', 'core'),
    spec('core/graph/.spec/api.d.ts', 'core.graph'),
    spec('ports/.spec/api.d.ts', 'ports'),
    spec('runtime/.spec/api.d.ts', 'runtime'),
    spec('runtime/query/.spec/api.d.ts', 'runtime.query'),
    spec('runtime/query/cursor/.spec/api.d.ts', 'runtime.query.cursor'),
    spec('runtime/query/planner/.spec/api.d.ts', 'runtime.query.planner'),
    spec('runtime/mutation/.spec/api.d.ts', 'runtime.mutation'),
    spec('runtime/mutation/planner/.spec/api.d.ts', 'runtime.mutation.planner'),
    spec('backend/.spec/api.d.ts', 'backend'),
    spec('host/.spec/api.d.ts', 'host'),
  ]
  const families = buildNavigationFamilies(buildNavigationTree(specs))

  it('keeps compact root families while resolving the active family from any descendant', () => {
    expect(families.map((family) => family.name)).toEqual([
      'backend',
      'core',
      'host',
      'ports',
      'runtime',
    ])
    expect(navigationFamilyForSource('core/graph/.spec/api.d.ts')).toBe('core')
    expect(navigationFamilyForSource('runtime/query/planner/.spec/api.d.ts')).toBe('runtime')
  })

  it('opens the current breadcrumb segment onto modules with the same owner', () => {
    const breadcrumb = navigationBreadcrumb(specs, 'runtime/query/planner/.spec/api.d.ts')
    expect(breadcrumb).toMatchObject({ name: 'planner', context: 'runtime / query' })
    expect(breadcrumb?.siblings.map(({ name }) => name)).toEqual(['cursor', 'planner'])
  })

  it('provides shallow and full family projections for progressive disclosure', () => {
    const runtime = families.find((family) => family.name === 'runtime')!
    expect(navigationFamilyModules(runtime, 'children').map(({ name }) => name)).toEqual([
      'runtime',
      'mutation',
      'query',
    ])
    expect(navigationFamilyModules(runtime, 'all')).toHaveLength(6)
  })

  it('groups real architecture families into layers and filters valid dependency edges', () => {
    expect(buildArchitectureLayers(families).map((layer) => layer.name)).toEqual([
      'Meaning',
      'Contracts',
      'Execution',
      'Composition',
    ])
    expect(architectureRelationships(families)).toEqual(
      expect.arrayContaining([
        { from: 'runtime', to: 'ports', label: 'orchestrates' },
        { from: 'host', to: 'runtime', label: 'boots' },
        { from: 'host', to: 'backend', label: 'selects' },
      ]),
    )
    expect(architectureRelationships(families)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ from: 'client' })]),
    )
  })

  it('derives Mermaid system-flow and dependency views from the same family model', () => {
    const architectureSpecs = [
      'backend',
      'client',
      'core',
      'dsl',
      'host',
      'ports',
      'protocol',
      'runtime',
      'server',
    ].map((name) => spec(`${name}/.spec/api.d.ts`, name, { icon: testIcon(name) }))
    const architectureFamilies = buildNavigationFamilies(buildNavigationTree(architectureSpecs))
    const layers = buildArchitectureLayers(architectureFamilies)
    const relationships = architectureRelationships(architectureFamilies)
    const flow = systemFlowMermaid(architectureFamilies)
    const dependencies = dependencyMermaid(layers, relationships, 'modules', 'runtime')
    const iconPack = architectureIconPack(architectureFamilies)

    expect(flow).toContain('subgraph host_boundary[" "]')
    expect(flow).not.toContain('host_badge@{')
    expect(flow).not.toContain('subgraph host_execution')
    expect(flow).toContain('client --> protocol')
    expect(flow).toContain('server --> ports')
    expect(flow).toContain('runtime --> ports_backend')
    expect(flow).toContain('ports_backend --> backend')
    expect(flow).toContain('runtime -.-> core')
    expect(flow).toContain('dsl@{ icon: "astrale:dsl"')
    expect(flow).toContain('protocol -.-> dsl')
    expect(flow).not.toContain('dsl -.-> core')
    expect(dependencies).toContain('flowchart LR')
    expect(dependencies).toContain('runtime@{ icon: "astrale:runtime"')
    expect(dependencies).toContain('runtime -->|orchestrates| ports')
    expect(dependencies).not.toContain('client@{')
    expect(iconPack.icons.icons.core?.body).toContain('stroke="#3366cc"')
  })

  it('opens architecture-map modules directly in API', () => {
    expect(architectureModuleHref('runtime/.spec/api.d.ts')).toBe(
      '?spec=runtime%2F.spec%2Fapi.d.ts&tab=api',
    )
  })

  it('does not let the previous module overwrite a valid transition target', () => {
    const entries = [
      spec('runtime/query/.spec/api.d.ts', 'runtime.query'),
      spec('runtime/functions/.spec/api.d.ts', 'runtime.functions'),
    ]

    expect(
      isCatalogTransitionTarget(
        entries,
        'runtime/functions/.spec/api.d.ts',
        'runtime/query/.spec/api.d.ts',
      ),
    ).toBe(true)
    expect(
      isCatalogTransitionTarget(
        entries,
        'missing/.spec/api.d.ts',
        'runtime/query/.spec/api.d.ts',
      ),
    ).toBe(false)
  })
})

function spec(
  source: string,
  title: string,
  options: {
    searchText?: string
    status?: CatalogSpecEntry['metrics']['status']
    declarations?: readonly string[]
    icon?: CatalogSpecEntry['icon']
  } = {},
): CatalogSpecEntry {
  return {
    title,
    source,
    ...(options.searchText ? { searchText: options.searchText } : {}),
    revision: '0'.repeat(64),
    metrics: {
      errors: options.status === 'error' ? 1 : 0,
      open: 0,
      status: options.status ?? 'ok',
    },
    ...(options.declarations ? { apiDeclarationIdentities: options.declarations } : {}),
    ...(options.icon ? { icon: options.icon } : {}),
  }
}

function testIcon(label: string): NonNullable<CatalogSpecEntry['icon']> {
  return {
    name: 'svg',
    attributes: { viewBox: '0 0 24 24', fill: 'none', stroke: '#3366cc' },
    children: [
      { name: 'path', attributes: { d: `M4 12h${Math.min(16, label.length + 5)}` }, children: [] },
    ],
  }
}

function project(nodes: NavigationNode[]): unknown[] {
  return nodes.map((node) =>
    node.kind === 'folder'
      ? { [node.name]: project(node.children) }
      : node.kind === 'module'
        ? { module: node.name, spec: node.spec.title }
        : node.spec.title,
  )
}

function folder(nodes: NavigationNode[], name: string) {
  const result = nodes.find((node) => node.kind === 'folder' && node.name === name)
  if (!result || result.kind !== 'folder') throw new Error(`Missing navigation folder: ${name}`)
  return result
}

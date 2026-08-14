import type { CatalogSpecEntry, CatalogSpecMetrics } from '../../viewer-host/catalog.ts'
import type { NavigationNode, NavigationTree } from './navigation-model.ts'

import {
  navigationCurrentIdentity,
  navigationLocation,
  navigationModuleOwnsFolder,
} from './navigation-model.ts'

export interface NavigationFamily {
  readonly key: string
  readonly name: string
  readonly node: NavigationNode
  readonly specs: readonly CatalogSpecEntry[]
  readonly identitySpec: CatalogSpecEntry
  readonly metrics: Pick<CatalogSpecMetrics, 'errors' | 'open'>
}

export interface NavigationSibling {
  readonly name: string
  readonly context?: string
  readonly spec: CatalogSpecEntry
}

export interface NavigationBreadcrumb {
  readonly name: string
  readonly context?: string
  readonly iconSpec?: CatalogSpecEntry
  readonly siblings: readonly NavigationSibling[]
}

export interface ArchitectureLayer {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly families: readonly NavigationFamily[]
}

export interface ArchitectureRelationship {
  readonly from: string
  readonly to: string
  readonly label: string
}

const LAYERS = [
  {
    key: 'meaning',
    name: 'Meaning',
    description: 'Portable language and canonical semantic values.',
    families: ['dsl', 'core'],
  },
  {
    key: 'contracts',
    name: 'Contracts',
    description: 'Capability boundaries and interoperable wire agreements.',
    families: ['ports', 'protocol'],
  },
  {
    key: 'execution',
    name: 'Execution',
    description: 'Semantic orchestration and physical provider implementations.',
    families: ['runtime', 'backend'],
  },
  {
    key: 'access',
    name: 'Access',
    description: 'Remote callers and portable server applications.',
    families: ['client', 'server'],
  },
  {
    key: 'composition',
    name: 'Composition',
    description: 'Deployment lifecycle, profiles, listeners, and readiness.',
    families: ['host'],
  },
] as const

const RELATIONSHIPS = [
  { from: 'protocol', to: 'dsl', label: 'portable values' },
  { from: 'protocol', to: 'core', label: 'canonical identity' },
  { from: 'ports', to: 'dsl', label: 'boundary values' },
  { from: 'ports', to: 'core', label: 'semantic contracts' },
  { from: 'runtime', to: 'ports', label: 'orchestrates' },
  { from: 'runtime', to: 'core', label: 'interprets' },
  { from: 'runtime', to: 'dsl', label: 'executes' },
  { from: 'backend', to: 'ports', label: 'implements' },
  { from: 'server', to: 'ports', label: 'dispatches' },
  { from: 'server', to: 'protocol', label: 'transports' },
  { from: 'client', to: 'protocol', label: 'speaks' },
  { from: 'host', to: 'runtime', label: 'boots' },
  { from: 'host', to: 'backend', label: 'selects' },
  { from: 'host', to: 'server', label: 'listens' },
] as const

export function buildNavigationFamilies(tree: NavigationTree): readonly NavigationFamily[] {
  return tree.nodes.map((node) => {
    const specs = node.kind === 'folder' ? node.specs : [node.spec]
    const identitySpec =
      (node.kind === 'folder' ? node.module : undefined) ??
      specs.find((spec) => spec.icon) ??
      specs[0]!
    return {
      key: node.key,
      name: node.kind === 'spec' ? node.spec.title : node.name,
      node,
      specs,
      identitySpec,
      metrics: specs.reduce(
        (metrics, spec) => ({
          errors: metrics.errors + spec.metrics.errors,
          open: metrics.open + spec.metrics.open,
        }),
        { errors: 0, open: 0 },
      ),
    }
  })
}

export function navigationFamilyForSource(source: string | undefined): string | undefined {
  if (!source) return
  const location = navigationLocation(source)
  return location.folders[0] ?? source.split('/').find((segment) => segment && segment !== '.spec')
}

export function navigationBreadcrumb(
  specs: readonly CatalogSpecEntry[],
  source: string | undefined,
): NavigationBreadcrumb | undefined {
  const active = specs.find((spec) => spec.source === source)
  if (!active) return
  const activePath = navigationIdentityPath(active)
  const parent = activePath.slice(0, -1)
  const identity = navigationCurrentIdentity(active.source, active.title)
  const siblings = specs
    .flatMap((spec): NavigationSibling[] => {
      const path = navigationIdentityPath(spec)
      if (
        path.length !== activePath.length ||
        !parent.every((segment, index) => path[index] === segment)
      ) {
        return []
      }
      const siblingIdentity = navigationCurrentIdentity(spec.source, spec.title)
      return [{ ...siblingIdentity, spec }]
    })
    .sort((left, right) => compare(left.name, right.name) || compare(left.spec.source, right.spec.source))
  return { ...identity, iconSpec: active, siblings }
}

export function buildArchitectureLayers(
  families: readonly NavigationFamily[],
): readonly ArchitectureLayer[] {
  const byName = new Map(families.map((family) => [family.name, family]))
  const claimed = new Set<string>()
  const layers: ArchitectureLayer[] = LAYERS.flatMap((layer): ArchitectureLayer[] => {
    const members = layer.families.flatMap((name) => {
      const family = byName.get(name)
      if (family) claimed.add(name)
      return family ? [family] : []
    })
    return members.length ? [{ ...layer, families: members }] : []
  })
  const tools = families.filter((family) => !claimed.has(family.name))
  if (tools.length) {
    layers.push({
      key: 'tools',
      name: 'Tooling',
      description: 'Specification and repository support surfaces.',
      families: tools,
    })
  }
  return layers
}

export function architectureRelationships(
  families: readonly NavigationFamily[],
): readonly ArchitectureRelationship[] {
  const names = new Set(families.map((family) => family.name))
  return RELATIONSHIPS.filter(({ from, to }) => names.has(from) && names.has(to))
}

export function navigationFamilyModules(
  family: NavigationFamily,
  depth: 'children' | 'all',
): readonly NavigationSibling[] {
  const rootDepth = family.name.split('/').length
  const seen = new Set<string>()
  return family.specs
    .flatMap((spec): NavigationSibling[] => {
      const path = navigationIdentityPath(spec)
      if (depth === 'children' && path.length > rootDepth + 1) return []
      if (seen.has(spec.source)) return []
      seen.add(spec.source)
      return [{ ...navigationCurrentIdentity(spec.source, spec.title), spec }]
    })
    .sort((left, right) => compare(left.spec.source, right.spec.source))
}

function navigationIdentityPath(spec: CatalogSpecEntry): string[] {
  const location = navigationLocation(spec.source)
  return navigationModuleOwnsFolder(spec.source)
    ? location.folders
    : [...location.folders, spec.title]
}

function compare(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase()
  const normalizedRight = right.toLocaleLowerCase()
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0
}

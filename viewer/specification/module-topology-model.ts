import type { CatalogSpecEntry } from '../../viewer-host/catalog.ts'

export type ModuleTopologyMode = 'composition' | 'dependencies'

export interface ModuleTopologyNode {
  readonly id: string
  readonly label: string
  readonly source: string
  readonly kind: 'root' | 'module' | 'context'
  readonly entry: CatalogSpecEntry
}

export interface ModuleTopologyEdge {
  readonly from: string
  readonly to: string
  readonly kind: 'composition' | 'contract' | 'scope' | 'context'
  readonly declarations: number
}

export interface ModuleTopology {
  readonly scope: string
  readonly modules: readonly ModuleTopologyNode[]
  readonly context: readonly ModuleTopologyNode[]
  readonly composition: readonly ModuleTopologyEdge[]
  readonly dependencies: readonly ModuleTopologyEdge[]
  readonly contextDependencies: readonly ModuleTopologyEdge[]
}

export interface ModuleTopologyIndex {
  readonly entries: readonly CatalogSpecEntry[]
  readonly entryBySource: ReadonlyMap<string, CatalogSpecEntry>
  readonly entryByOwnerPath: ReadonlyMap<string, CatalogSpecEntry>
  readonly childrenBySource: ReadonlyMap<string, readonly CatalogSpecEntry[]>
  readonly familyEntry: ReadonlyMap<string, CatalogSpecEntry>
}

/** Index catalog ownership once; selected-module graph work is then bounded by its direct children. */
export function createModuleTopologyIndex(
  entries: readonly CatalogSpecEntry[],
): ModuleTopologyIndex {
  const ordered = [...entries].sort((left, right) => compare(left.source, right.source))
  const entryBySource = new Map(ordered.map((entry) => [entry.source, entry]))
  const entryByOwnerPath = new Map(
    ordered.map((entry) => [moduleOwnerPath(entry.source), entry]),
  )
  const mutableChildren = new Map<string, CatalogSpecEntry[]>()
  const familyEntry = new Map<string, CatalogSpecEntry>()

  for (const entry of ordered) {
    const path = moduleOwnerPath(entry.source)
    const family = path.split('/')[0]
    if (family && (!familyEntry.has(family) || path === family)) familyEntry.set(family, entry)

    const segments = path.split('/').filter(Boolean)
    for (let length = segments.length - 1; length > 0; length -= 1) {
      const parent = entryByOwnerPath.get(segments.slice(0, length).join('/'))
      if (!parent) continue
      const children = mutableChildren.get(parent.source)
      if (children) children.push(entry)
      else mutableChildren.set(parent.source, [entry])
      break
    }
  }

  const childrenBySource = new Map(
    [...mutableChildren].map(([source, children]) => [
      source,
      children.sort(
        (left, right) =>
          compare(moduleLabel(left), moduleLabel(right)) || compare(left.source, right.source),
      ),
    ]),
  )
  return { entries: ordered, entryBySource, entryByOwnerPath, childrenBySource, familyEntry }
}

export function hasModuleTopology(
  index: ModuleTopologyIndex,
  source: string,
): boolean {
  return (index.childrenBySource.get(source)?.length ?? 0) > 0
}

/** Normalize catalog hierarchy and compiled contracts into one bounded graph. */
export function buildModuleTopology(
  index: ModuleTopologyIndex,
  source: string,
): ModuleTopology | undefined {
  const rootEntry = index.entryBySource.get(source)
  if (!rootEntry) return
  const children = immediateModuleChildren(index, source)
  if (!children.length) return

  const scope = moduleOwnerPath(source)
  const moduleEntries = [rootEntry, ...children]
  const modules = moduleEntries.map((entry, index): ModuleTopologyNode => ({
    id: `module_${index}`,
    label: moduleLabel(entry),
    source: entry.source,
    kind: index === 0 ? 'root' : 'module',
    entry,
  }))
  const composition = modules.slice(1).map((node): ModuleTopologyEdge => ({
    from: modules[0]!.id,
    to: node.id,
    kind: 'composition',
    declarations: 0,
  }))
  const moduleBySource = new Map(modules.map((node) => [node.source, node]))
  const moduleByOwnerPath = new Map(
    modules.map((node) => [moduleOwnerPath(node.source), node]),
  )
  const internal = new Map<string, ModuleTopologyEdge>()
  const external = new Map<string, { from: string; family: string; declarations: number }>()

  for (const from of modules) {
    for (const dependency of from.entry.contractDependencies ?? []) {
      const direct = moduleBySource.get(dependency.source)
      const target = direct ?? containingModule(moduleByOwnerPath, dependency.source)
      if (target) {
        if (target.id === from.id) continue
        mergeEdge(internal, {
          from: from.id,
          to: target.id,
          kind: from.kind === 'root' ? 'scope' : 'contract',
          declarations: dependency.declarations,
        })
        continue
      }
      const targetEntry = index.entryBySource.get(dependency.source)
      if (!targetEntry) continue
      const family = moduleOwnerPath(targetEntry.source).split('/')[0]
      if (!family || family === scope.split('/')[0]) continue
      const key = `${from.id}\0${family}`
      const current = external.get(key)
      external.set(key, {
        from: from.id,
        family,
        declarations: (current?.declarations ?? 0) + dependency.declarations,
      })
    }
  }

  const families = [...new Set([...external.values()].map(({ family }) => family))].sort(compare)
  const context = families.map((family, nodeIndex): ModuleTopologyNode => {
    const entry = indexModuleEntry(index, family)
    return {
      id: `context_${nodeIndex}`,
      label: family,
      source: entry.source,
      kind: 'context',
      entry,
    }
  })
  const contextByFamily = new Map(context.map((node) => [node.label, node]))
  const contextDependencies = [...external.values()]
    .map(({ from, family, declarations }): ModuleTopologyEdge => ({
      from,
      to: contextByFamily.get(family)!.id,
      kind: 'context',
      declarations,
    }))
    .sort(compareEdges)

  return {
    scope: moduleLabel(rootEntry),
    modules,
    context,
    composition,
    dependencies: [...internal.values()].sort(compareEdges),
    contextDependencies,
  }
}

export function immediateModuleChildren(
  index: ModuleTopologyIndex,
  source: string,
): readonly CatalogSpecEntry[] {
  return index.childrenBySource.get(source) ?? []
}

export function moduleOwnerPath(source: string): string {
  const segments = source.split('/').filter(Boolean)
  const hidden = segments.lastIndexOf('.spec')
  if (hidden >= 0) return segments.slice(0, hidden).join('/')
  return segments.join('/')
}

function containingModule(
  moduleByOwnerPath: ReadonlyMap<string, ModuleTopologyNode>,
  source: string,
): ModuleTopologyNode | undefined {
  const segments = moduleOwnerPath(source).split('/').filter(Boolean)
  for (let length = segments.length; length > 0; length -= 1) {
    const node = moduleByOwnerPath.get(segments.slice(0, length).join('/'))
    if (node) return node
  }
  return undefined
}

function indexModuleEntry(index: ModuleTopologyIndex, family: string): CatalogSpecEntry {
  const entry = index.familyEntry.get(family)
  if (!entry) throw new Error(`Catalog topology context ${JSON.stringify(family)} is missing.`)
  return entry
}

function mergeEdge(
  edges: Map<string, ModuleTopologyEdge>,
  edge: ModuleTopologyEdge,
): void {
  const key = `${edge.from}\0${edge.to}\0${edge.kind}`
  const current = edges.get(key)
  edges.set(key, {
    ...edge,
    declarations: (current?.declarations ?? 0) + edge.declarations,
  })
}

function moduleLabel(entry: CatalogSpecEntry): string {
  return moduleOwnerPath(entry.source).split('/').at(-1) ?? entry.title
}

function compareEdges(left: ModuleTopologyEdge, right: ModuleTopologyEdge): number {
  return compare(left.from, right.from) || compare(left.to, right.to) || compare(left.kind, right.kind)
}

function compare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

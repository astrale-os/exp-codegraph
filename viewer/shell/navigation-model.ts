import type { CatalogSpecEntry } from '../../viewer-host/catalog.ts'

export interface NavigationSpecNode {
  kind: 'spec'
  key: string
  sourceName: string
  duplicateName?: string
  spec: CatalogSpecEntry
}

export interface NavigationFolderNode {
  kind: 'folder'
  key: string
  name: string
  children: NavigationNode[]
  specs: CatalogSpecEntry[]
  /** Canonical module specification owned by this folder, when it also has child modules. */
  module?: CatalogSpecEntry
}

export interface NavigationModuleNode {
  kind: 'module'
  key: string
  name: string
  spec: CatalogSpecEntry
}

export type NavigationNode = NavigationFolderNode | NavigationModuleNode | NavigationSpecNode

export interface NavigationTree {
  nodes: NavigationNode[]
  specCount: number
}

export interface NavigationCurrentIdentity {
  name: string
  context?: string
}

interface MutableFolder {
  key: string
  name: string
  folders: Map<string, MutableFolder>
  specs: Array<{ spec: CatalogSpecEntry; sourceName: string; ownsFolder: boolean }>
}

export function buildNavigationTree(
  specs: readonly CatalogSpecEntry[],
  query = '',
): NavigationTree {
  const needle = query.trim().toLocaleLowerCase()
  const visible = needle
    ? specs.filter((spec) =>
        `${spec.title} ${spec.source} ${spec.searchText ?? ''}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : specs
  const root: MutableFolder = {
    key: '',
    name: '',
    folders: new Map(),
    specs: [],
  }

  for (const spec of visible) {
    const location = navigationLocation(spec.source)
    let parent = root
    const path: string[] = []
    for (const segment of location.folders) {
      path.push(segment)
      const key = path.join('/')
      let folder = parent.folders.get(segment)
      if (!folder) {
        folder = { key, name: segment, folders: new Map(), specs: [] }
        parent.folders.set(segment, folder)
      }
      parent = folder
    }
    parent.specs.push({
      spec,
      sourceName: location.sourceName,
      ownsFolder: navigationModuleOwnsFolder(spec.source),
    })
  }

  return { nodes: finalize(root).children, specCount: visible.length }
}

export function navigationLocation(source: string): {
  folders: string[]
  sourceName: string
} {
  const segments = source.split('/').filter(Boolean)

  const hiddenCatalog = segments.lastIndexOf('.spec')
  if (hiddenCatalog >= 0) {
    const owner = segments.slice(0, hiddenCatalog)
    const entries = segments.slice(hiddenCatalog + 1)
    if (entries.length === 1 && entries[0] === 'api.d.ts') {
      return {
        folders: owner,
        sourceName: owner.at(-1) ?? 'module',
      }
    }
    if (entries.length > 0) {
      return {
        folders: [...owner, ...entries.slice(0, -1)],
        sourceName: entries.at(-1)!,
      }
    }
    return {
      folders: owner,
      sourceName: owner.at(-1) ?? 'specification',
    }
  }

  return {
    folders: segments.slice(0, -1),
    sourceName: segments.at(-1) ?? 'specification',
  }
}

export function navigationExpansionKeys(source: string): string[] {
  const keys: string[] = []
  const location = navigationLocation(source)
  const folders = navigationModuleOwnsFolder(source)
    ? location.folders.slice(0, -1)
    : location.folders
  for (const segment of folders) {
    keys.push(keys.length ? `${keys.at(-1)}/${segment}` : segment)
  }
  return keys
}

/** Compact owner-aware identity for the current-module navigation pin. */
export function navigationCurrentIdentity(
  source: string,
  title: string,
): NavigationCurrentIdentity {
  const location = navigationLocation(source)
  if (navigationModuleOwnsFolder(source)) {
    const name = location.folders.at(-1) ?? location.sourceName
    const context = location.folders.slice(0, -1).join(' / ')
    return { name, ...(context ? { context } : {}) }
  }
  const context = location.folders.join(' / ')
  return { name: title, ...(context ? { context } : {}) }
}

function finalize(folder: MutableFolder): NavigationFolderNode {
  const folders = [...folder.folders.values()]
    .sort((left, right) => compare(left.name, right.name))
    .map((child) => collapseModule(finalize(child)))
  const module = folder.specs.find(({ ownsFolder }) => ownsFolder)?.spec
  const visibleSpecs = folder.specs.filter(({ ownsFolder }) => !ownsFolder)
  const duplicateNames = new Map<string, number>()
  for (const { spec } of visibleSpecs) {
    const name = spec.title.toLocaleLowerCase()
    duplicateNames.set(name, (duplicateNames.get(name) ?? 0) + 1)
  }
  const specs: NavigationSpecNode[] = visibleSpecs
    .sort(
      (left, right) =>
        compare(left.spec.title, right.spec.title) || compare(left.spec.source, right.spec.source),
    )
    .map(({ spec, sourceName }) => ({
      kind: 'spec',
      key: spec.source,
      sourceName,
      duplicateName:
        (duplicateNames.get(spec.title.toLocaleLowerCase()) ?? 0) > 1 ? sourceName : undefined,
      spec,
    }))
  const children: NavigationNode[] = [...folders, ...specs]
  const descendants = [
    ...(module ? [module] : []),
    ...children.flatMap((child) => (child.kind === 'folder' ? child.specs : [child.spec])),
  ]
  return {
    kind: 'folder',
    key: folder.key,
    name: folder.name,
    children,
    specs: descendants,
    ...(module ? { module } : {}),
  }
}

function collapseModule(folder: NavigationFolderNode): NavigationFolderNode | NavigationModuleNode {
  if (folder.module && folder.children.length === 0) {
    return {
      kind: 'module',
      key: folder.key,
      name: folder.name,
      spec: folder.module,
    }
  }
  if (folder.children.length !== 1) return folder
  const child = folder.children[0]!
  if (child.kind !== 'spec') return folder
  return {
    kind: 'module',
    key: folder.key,
    name: folder.name,
    spec: child.spec,
  }
}

export function navigationModuleOwnsFolder(source: string): boolean {
  const segments = source.split('/').filter(Boolean)
  const hiddenCatalog = segments.lastIndexOf('.spec')
  if (hiddenCatalog < 0) return false
  const entries = segments.slice(hiddenCatalog + 1)
  return entries.length === 1 && entries[0] === 'api.d.ts'
}

function compare(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase()
  const normalizedRight = right.toLocaleLowerCase()
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0
}

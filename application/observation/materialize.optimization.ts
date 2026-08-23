import type { RepositoryInventory } from '../../repository/index.ts'

type RepositoryFile = RepositoryInventory['files'][number]

export interface ApplicationObservationInventoryIndex {
  readonly byPath: ReadonlyMap<string, RepositoryFile>
  readonly historyByRoot: ReadonlyMap<string, readonly RepositoryFile[]>
}

/** Index immutable inventory paths once for every owner observation in the operation. */
export function indexApplicationObservationInventory(
  inventory: RepositoryInventory,
): ApplicationObservationInventoryIndex {
  const byPath = new Map<string, RepositoryFile>()
  const historyByRoot = new Map<string, RepositoryFile[]>()
  for (const file of inventory.files) {
    byPath.set(file.path, file)
    const historyRoot = owningHistoryRoot(file.path)
    if (!historyRoot) continue
    const history = historyByRoot.get(historyRoot) ?? []
    history.push(file)
    historyByRoot.set(historyRoot, history)
  }
  for (const history of historyByRoot.values()) {
    history.sort((left, right) => left.path.localeCompare(right.path))
  }
  return { byPath, historyByRoot }
}

function owningHistoryRoot(path: string): string | undefined {
  if (path.startsWith('.history/')) return '.history/'
  const marker = '/.history/'
  const offset = path.indexOf(marker)
  return offset < 0 ? undefined : `${path.slice(0, offset)}${marker}`
}

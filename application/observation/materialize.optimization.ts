import type { RepositoryInventory } from '../../repository/index.ts'

type RepositoryFile = RepositoryInventory['files'][number]

const MAXIMUM_CONCURRENT_OWNER_OBSERVATIONS = 4

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

/** Schedule independent owner reads concurrently while retaining canonical input order. */
export async function mapApplicationObservationOwners<Input, Output>(
  inputs: readonly Input[],
  operation: (input: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const output = new Array<Output>(inputs.length)
  const failures: { readonly index: number; readonly error: unknown }[] = []
  let next = 0
  let stopped = false
  await Promise.all(
    Array.from(
      { length: Math.min(MAXIMUM_CONCURRENT_OWNER_OBSERVATIONS, inputs.length) },
      async () => {
        while (true) {
          if (stopped) return
          const index = next++
          if (index >= inputs.length) return
          try {
            output[index] = await operation(inputs[index]!)
          } catch (error) {
            stopped = true
            failures.push({ index, error })
          }
        }
      },
    ),
  )
  if (failures.length) {
    failures.sort((left, right) => left.index - right.index)
    throw failures[0]!.error
  }
  return output
}

function owningHistoryRoot(path: string): string | undefined {
  if (path.startsWith('.history/')) return '.history/'
  const marker = '/.history/'
  const offset = path.indexOf(marker)
  return offset < 0 ? undefined : `${path.slice(0, offset)}${marker}`
}

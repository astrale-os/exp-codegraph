/** Minimal snapshot boundary implemented by content-validated process caches. */
export interface RestorableCache {
  snapshot(scope: string): unknown
  restore(scope: string, snapshot: unknown): void
}

export function cacheEntries<Value>(cache: ReadonlyMap<string, Value>): unknown {
  return [...cache]
}

export function restoreCacheEntries<Value>(
  snapshot: unknown,
  capacity: number,
  isValue: (value: unknown) => value is Value,
): Array<readonly [string, Value]> {
  if (!Array.isArray(snapshot)) return []
  const entries: Array<readonly [string, Value]> = []
  for (const candidate of snapshot.slice(-capacity)) {
    if (
      !Array.isArray(candidate) ||
      candidate.length !== 2 ||
      typeof candidate[0] !== 'string' ||
      !isValue(candidate[1])
    )
      continue
    entries.push([candidate[0], candidate[1]])
  }
  return entries
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function stringRecord(value: unknown): value is { file: string; revision: string } {
  return record(value) && typeof value.file === 'string' && typeof value.revision === 'string'
}

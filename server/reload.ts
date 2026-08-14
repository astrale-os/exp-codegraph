import { stat } from 'node:fs/promises'

import type { ViewerCatalog } from '../viewer-host/specification.ts'

export interface CatalogRebuildResult {
  readonly catalog: ViewerCatalog
  readonly changed: boolean
  readonly generation: number
}

export interface RebuildScheduler {
  request(): Promise<CatalogRebuildResult>
}

export interface SourceChangeFilter {
  changed(file: string): Promise<boolean>
}

/** Coalesce event bursts and rebuild only after the latest edit has remained quiet. */
export function createRebuildScheduler(
  rebuild: () => Promise<CatalogRebuildResult>,
  debounceMs = 80,
): RebuildScheduler {
  let requested = 0
  let completed = 0
  let running: Promise<CatalogRebuildResult> | undefined

  return {
    request() {
      requested++
      if (running) return running
      running = (async () => {
        let latest: CatalogRebuildResult | undefined
        let changed = false
        while (completed < requested) {
          await waitForQuiet()
          const target = requested
          latest = await rebuild()
          changed ||= latest.changed
          completed = target
        }
        if (!latest) throw new Error('Rebuild scheduler completed without rebuilding.')
        return { ...latest, changed }
      })().finally(() => {
        running = undefined
      })
      return running
    },
  }

  async function waitForQuiet(): Promise<void> {
    let observed: number
    do {
      observed = requested
      await delay(debounceMs)
    } while (observed !== requested)
  }
}

/** Suppress duplicate watcher notifications without interpreting source semantics. */
export function createSourceChangeFilter(capacity = 4_096): SourceChangeFilter {
  const observed = new Map<string, string>()
  return {
    async changed(file) {
      const fingerprint = await sourceFingerprint(file)
      const previous = observed.get(file)
      observed.delete(file)
      observed.set(file, fingerprint)
      while (observed.size > capacity) observed.delete(observed.keys().next().value!)
      return previous !== fingerprint
    },
  }
}

async function sourceFingerprint(file: string): Promise<string> {
  try {
    const details = await stat(file, { bigint: true })
    return [details.dev, details.ino, details.size, details.mtimeNs, details.ctimeNs].join(':')
  } catch (error) {
    if (!isMissing(error)) throw error
    return 'missing'
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

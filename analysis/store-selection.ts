import { createMemoryAnalysisStore, type MemoryAnalysisStoreOptions } from './memory/index.ts'
import type { AnalysisStore } from './query/index.ts'

export type PersistenceRequirement = 'advisory' | 'required'

export interface AnalysisStoreSelectionOptions {
  readonly persistence: PersistenceRequirement
  /** Explicit application-owned durable store factory; repositories cannot select executable code. */
  readonly openDurable?: () => Promise<AnalysisStore>
  readonly memory?: MemoryAnalysisStoreOptions
}
export interface AnalysisStoreSelection {
  readonly store: AnalysisStore
  readonly backend: 'durable' | 'memory'
  readonly persistence: PersistenceRequirement
  readonly fallback?: {
    readonly code: 'DURABLE_STORE_UNAVAILABLE'
    readonly message: string
    readonly cause: unknown
  }
}

export class AnalysisStoreUnavailableError extends Error {
  readonly name = 'AnalysisStoreUnavailableError'
  readonly code = 'DURABLE_STORE_UNAVAILABLE'
}

/** Resolve persistence once; required durability fails and advisory durability is explicit. */
export async function selectAnalysisStore(
  options: AnalysisStoreSelectionOptions,
): Promise<AnalysisStoreSelection> {
  if (options.openDurable) {
    try {
      return {
        store: await options.openDurable(),
        backend: 'durable',
        persistence: options.persistence,
      }
    } catch (cause) {
      if (options.persistence === 'required') {
        throw new AnalysisStoreUnavailableError('Required durable analysis store is unavailable.', {
          cause,
        })
      }
      return {
        store: createMemoryAnalysisStore(options.memory),
        backend: 'memory',
        persistence: 'advisory',
        fallback: {
          code: 'DURABLE_STORE_UNAVAILABLE',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        },
      }
    }
  }
  if (options.persistence === 'required') {
    throw new AnalysisStoreUnavailableError(
      'Required durable analysis store has no configured factory.',
    )
  }
  return {
    store: createMemoryAnalysisStore(options.memory),
    backend: 'memory',
    persistence: 'advisory',
  }
}

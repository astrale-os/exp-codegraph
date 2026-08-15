import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import type { AnalysisStore } from '../../analysis/index.ts'
import { selectAnalysisStore } from '../../analysis/index.ts'
import { createSQLiteAnalysisStore } from '../../analysis/sqlite/index.ts'
import type { TypeSpecApplicationService } from '../index.ts'
import { createTypeSpecApplicationService } from '../service.ts'

export interface NodeTypeSpecApplicationOptions {
  readonly root: string
  readonly cacheDirectory: string
  readonly persistence?: 'advisory' | 'memory'
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly maximumRetainedGenerations?: number
}

/** Node-owned store/native composition around the portable headless application service. */
export async function createNodeTypeSpecApplicationService(
  options: NodeTypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService> {
  const root = resolve(options.root)
  const maximumRetainedGenerations = options.maximumRetainedGenerations ?? 2
  const selection = await selectAnalysisStore({
    persistence: 'advisory',
    ...((options.persistence ?? 'advisory') === 'advisory'
      ? {
          openDurable: () =>
            createSQLiteAnalysisStore({
              file: join(options.cacheDirectory, 'analysis-v2.sqlite'),
              // Physical isolation belongs to the store namespace, never semantic identities.
              namespace: `worktree:${createHash('sha256').update(root).digest('hex')}`,
              maximumRetainedGenerations,
            }),
        }
      : {}),
  })
  const store = selection.store
  try {
    const application = await createTypeSpecApplicationService({
      root,
      repository: options.repository ?? (await repositoryKey(root)),
      maximumRetainedSnapshots: options.maximumRetainedSnapshots,
      analysis: { store, maximumRetainedGenerations },
    })
    return ownStore(application, store)
  } catch (error) {
    await store.dispose()
    throw error
  }
}

function ownStore(
  application: TypeSpecApplicationService,
  store: AnalysisStore,
): TypeSpecApplicationService {
  let disposed = false
  return {
    refresh: (options) => application.refresh(options),
    current: () => application.current(),
    open: (snapshot) => application.open(snapshot),
    async dispose() {
      if (disposed) return
      disposed = true
      const results = await Promise.allSettled([application.dispose(), store.dispose()])
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (rejected) throw rejected.reason
    },
  }
}

async function repositoryKey(root: string): Promise<string> {
  try {
    const value: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { readonly name?: unknown }).name === 'string'
    ) {
      const name = (value as { readonly name: string }).name.trim()
      if (name) return `package:${name}`
    }
  } catch {
    // Anonymous source trees remain usable without leaking absolute paths into semantic identity.
  }
  return `anonymous:${basename(root) || 'repository'}`
}

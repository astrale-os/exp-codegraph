import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DevOptions, RunningDevServer } from './model.ts'

export type { DevOptions, RunningDevServer } from './model.ts'

/** Source checkouts keep UI HMR; an installed build needs only its embedded assets. */
export async function startDev(options: DevOptions): Promise<RunningDevServer> {
  const root = await realpath(resolve(options.root))
  if (!(await stat(root)).isDirectory()) throw new Error('Root must be a directory.')
  const directory = dirname(fileURLToPath(import.meta.url))
  if (basename(dirname(directory)) === 'dist') {
    const { startEmbeddedViewer } = await import('./embedded.ts')
    return startEmbeddedViewer({ ...options, root }, resolve(directory, '../viewer'))
  }
  const { startSourceDev } = await import('./source-start.ts')
  return startSourceDev({ ...options, root })
}

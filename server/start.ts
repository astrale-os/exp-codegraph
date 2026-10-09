import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DevOptions, RunningDevServer } from './model.ts'

export type { DevOptions, RunningDevServer } from './model.ts'

/** Source checkouts keep UI HMR; installed builds acquire their immutable viewer on first use. */
export async function startDev(options: DevOptions): Promise<RunningDevServer> {
  const root = await realpath(resolve(options.root))
  if (!(await stat(root)).isDirectory()) throw new Error('Root must be a directory.')
  const directory = dirname(fileURLToPath(import.meta.url))
  const compiled = basename(dirname(directory)) === 'dist'
  const packageRoot = compiled ? resolve(directory, '../..') : resolve(directory, '..')
  if (compiled && !await sourceCheckout(packageRoot)) {
    const { startEmbeddedViewer } = await import('./embedded.ts')
    const { resolveViewerArchive } = await import('./viewer-release.ts')
    return startEmbeddedViewer({ ...options, root }, await resolveViewerArchive())
  }
  const { startSourceDev } = await import('./source-start.ts')
  return startSourceDev({ ...options, root })
}

async function sourceCheckout(packageRoot: string): Promise<boolean> {
  try {
    const inputs = await Promise.all(['viewer/index.html', 'scripts/build-viewer.mjs'].map((path) => stat(resolve(packageRoot, path))))
    return inputs.every((input) => input.isFile())
  } catch { return false }
}

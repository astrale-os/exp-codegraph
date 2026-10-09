import { realpath, stat } from 'node:fs/promises'
import type { Server } from 'node:http'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CodegraphApplicationSessionOptions } from '../application/analysis/index.ts'
import type { AnalysisTelemetrySink } from '../analysis/index.ts'
import type { CatalogBootstrap } from '../viewer-host/live.ts'

export interface DevOptions {
  root: string
  port?: number
  open?: boolean
  verify?: boolean
  cache?: boolean
  /** Explicit native analyzer for source-checkout development and controlled qualification. */
  native?: CodegraphApplicationSessionOptions
  /** Diagnostic-only operational telemetry; it cannot influence semantic output. */
  telemetry?: AnalysisTelemetrySink
}

export interface RunningDevServer {
  readonly server: { readonly httpServer: Pick<Server, 'address'> | null }
  readonly mode: 'source' | 'embedded'
  readonly url: string
  catalog(): Promise<CatalogBootstrap>
  close(): Promise<void>
}

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

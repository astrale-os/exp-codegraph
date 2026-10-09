import type { Server } from 'node:http'
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

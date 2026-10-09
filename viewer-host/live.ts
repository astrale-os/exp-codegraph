import type { CatalogIndex } from './catalog.ts'
import type { ViewerAdapterManifest } from './manifest.ts'

export const CATALOG_BOOTSTRAP_ENDPOINT = '/__astrale/spec-catalog'
export const CATALOG_EVENTS_ENDPOINT = '/__astrale/spec-events'

export interface CatalogBootstrap {
  readonly index: CatalogIndex
  readonly adapterManifest: ViewerAdapterManifest
  /** Server-local publication clock, including verification-only changes. */
  readonly generation: number
}

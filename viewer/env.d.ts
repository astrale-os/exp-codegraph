/// <reference types="vite/client" />

declare module 'mermaid/dist/mermaid.esm.min.mjs' {
  import type { Mermaid } from 'mermaid'

  const mermaid: Mermaid
  export default mermaid
}

declare module 'virtual:spec-catalog-index' {
  import type { CatalogIndex } from '../viewer-host/catalog.ts'
  import type { ViewerAdapterManifest } from '../viewer-host/manifest.ts'

  export const index: CatalogIndex
  export const adapterManifest: ViewerAdapterManifest
}

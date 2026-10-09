import { render } from 'preact'
import 'katex/dist/katex.min.css'

import { adaptersFromManifest } from './host/adapters.ts'
import { createHttpCatalogLoader } from './host/catalog.ts'
import { connectLiveCatalog } from './host/live.ts'
import { freeze } from './host/freeze.ts'
import { App } from './shell/app.tsx'
import './style.css'

const root = document.querySelector('#app')
if (!root) throw new Error('Viewer root is missing.')
const loader = createHttpCatalogLoader()
let mounted = false
const disconnect = connectLiveCatalog(({ index, adapterManifest }) => {
  mounted = true
  render(<App adapters={adaptersFromManifest(adapterManifest)} index={freeze(index)} loader={loader} />, root)
}, (error) => {
  if (!mounted) root.textContent = error instanceof Error ? error.message : 'Catalog unavailable.'
})

if (import.meta.hot) import.meta.hot.dispose(disconnect)

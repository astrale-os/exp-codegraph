import { render } from 'preact'
import { adapterManifest, index } from 'virtual:spec-catalog-index'
import 'katex/dist/katex.min.css'

import { adaptersFromManifest } from './host/adapters.ts'
import { createHttpCatalogLoader } from './host/catalog.ts'
import { freeze } from './host/freeze.ts'
import { App } from './shell/app.tsx'
import './style.css'

const root = document.querySelector('#app')
if (!root) throw new Error('Viewer root is missing.')
const loader = createHttpCatalogLoader()

const mount = (nextIndex = index, nextAdapterManifest = adapterManifest) => {
  render(
    <App
      adapters={adaptersFromManifest(nextAdapterManifest)}
      index={freeze(nextIndex)}
      loader={loader}
    />,
    root,
  )
}

mount()

if (import.meta.hot) {
  import.meta.hot.accept('virtual:spec-catalog-index', (next) => {
    if (next) mount(next.index, next.adapterManifest)
  })
}

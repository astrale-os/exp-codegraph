import type { Plugin } from 'vite'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

import { createCatalogRuntime, type CatalogRuntime, type CatalogRuntimeOptions } from './catalog-runtime.ts'
import { createCatalogChannel } from './catalog-channel.ts'

export const CATALOG_INDEX_ID = 'virtual:spec-catalog-index'
const RESOLVED_CATALOG_INDEX_ID = `\0${CATALOG_INDEX_ID}`
export type { CatalogServices as LiveSpecsServices } from './catalog-runtime.ts'
export interface LiveSpecsOptions extends CatalogRuntimeOptions { allowedRoots: string[] }

/** Source-checkout HMR adapter. Catalog authority and HTTP handlers are shared with the bundle. */
export function createLiveSpecsPlugin(options: LiveSpecsOptions): Plugin<CatalogRuntime> & { api: CatalogRuntime } {
  const runtime = createCatalogRuntime(options)
  const channel = createCatalogChannel(runtime)
  return {
    name: 'astrale-specs',
    enforce: 'pre',
    api: runtime,
    buildStart: () => runtime.initialize(),
    async closeBundle() {
      channel.close()
      await runtime.dispose()
    },
    resolveId: (id) => id === CATALOG_INDEX_ID ? RESOLVED_CATALOG_INDEX_ID : null,
    load: (id) => id === RESOLVED_CATALOG_INDEX_ID ? runtime.module() : null,
    async handleHotUpdate(context) {
      if (!await runtime.changed('change', context.file)) return
      const module = context.server.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID)
      if (!module) return []
      context.server.moduleGraph.invalidateModule(module)
      return [...new Set([module, ...context.modules])]
    },
    configureServer(vite) {
      vite.httpServer?.once('close', () => { channel.close(); void runtime.dispose() })
      vite.middlewares.use((request, response, next) => {
        void channel.handle(request, response).then((handled) => {
          if (!handled) next()
        }, next)
      })
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/@fs/')) return next()
        try {
          const pathname = new URL(request.url, 'http://localhost').pathname
          let file = decodeURIComponent(pathname.slice('/@fs/'.length))
          if (sep === '/' && !file.startsWith('/')) file = `/${file}`
          const target = await realpath(file)
          if (!options.allowedRoots.some((allowed) => within(allowed, target))) throw Error('outside roots')
          next()
        } catch {
          response.statusCode = 403
          response.end('Forbidden')
        }
      })
      vite.watcher.add(options.root)
      const reloadTopology = (event: 'add' | 'unlink', file: string) => {
        void runtime.changed(event, file).then(async (changed) => {
          if (!changed) return
          const module = vite.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID)
          if (module) await vite.reloadModule(module)
          else vite.ws.send({ type: 'full-reload' })
        }).catch((error: unknown) => {
          vite.config.logger.error(error instanceof Error ? error.message : String(error))
        })
      }
      vite.watcher.on('add', (file) => reloadTopology('add', file))
      vite.watcher.on('unlink', (file) => reloadTopology('unlink', file))
    },
  }
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

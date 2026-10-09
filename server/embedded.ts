import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve, sep, extname } from 'node:path'
import { spawn } from 'node:child_process'
import type { DevOptions, RunningDevServer } from './model.ts'
import { createCatalogRuntime } from './catalog-runtime.ts'
import { createCatalogChannel } from './catalog-channel.ts'
import { createViewerWatcher } from './file-watcher.ts'

/** Installed viewer: coherent catalog authority plus immutable, precompiled browser assets. */
export async function startEmbeddedViewer(options: DevOptions, assets: string): Promise<RunningDevServer> {
  const root = await realpath(resolve(options.root))
  if (!(await stat(root)).isDirectory()) throw new Error('Root must be a directory.')
  const assetRoot = await realpath(assets)
  const runtime = createCatalogRuntime({
    root, verify: options.verify ?? false, cache: options.cache ?? true,
    ...(options.native ? { native: options.native } : {}),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
  })
  const channel = createCatalogChannel(runtime)
  const requests = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const pending = handle(request, response).catch((error: unknown) => {
      if (response.headersSent) { response.destroy(); return }
      response.statusCode = 500
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(error instanceof Error ? error.message : String(error))
    }).finally(() => { requests.delete(pending) })
    requests.add(pending)
  })
  const watcher = createViewerWatcher(root)
  let watching = false
  const pending = new Map<string, 'add' | 'change' | 'unlink'>()
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => closing ??= (async () => {
    channel.close()
    await watcher.close()
    server.closeAllConnections()
    await new Promise<void>((resolveClose, reject) => {
        if (!server.listening) { resolveClose(); return }
        server.close((error) => error ? reject(error) : resolveClose())
      })
    await Promise.all([...requests])
    await runtime.dispose()
  })()
  watcher.on('all', (event, path) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return
    if (!watching) { pending.set(path, event); return }
    void runtime.changed(event, path).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
    })
  })
  try {
    // Observe first, then capture: changes during initialization enter the same rebuild queue.
    await new Promise<void>((ready, reject) => { watcher.once('ready', ready); watcher.once('error', reject) })
    await runtime.initialize()
    watching = true
    await Promise.all([...pending].map(([path, event]) => runtime.changed(event, path)))
    pending.clear()
    let port = options.port ?? 4173
    while (true) {
      try {
        await new Promise<void>((listening, reject) => {
          const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
          const onListening = () => { server.off('error', onError); listening() }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '127.0.0.1')
        })
        break
      } catch (error) {
        if (options.port !== undefined || !error || typeof error !== 'object' || !('code' in error) || error.code !== 'EADDRINUSE') throw error
        port++
      }
    }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Viewer did not expose a TCP address.')
    const url = `http://127.0.0.1:${address.port}`
    if (options.open) openBrowser(url)
    return { server: { httpServer: server }, mode: 'embedded', url, catalog: () => runtime.bootstrap(), close }
  } catch (error) {
    await close()
    throw error
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (closing) { response.statusCode = 503; response.end('Server closed.'); return }
    if (!allowedHost(request.headers.host)) { response.statusCode = 403; response.end('Forbidden'); return }
    if (await channel.handle(request, response)) return
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    // Installed mode never exposes workspace or dependency files through Vite's filesystem route.
    if (pathname.startsWith('/@fs/')) { response.statusCode = 403; response.end('Forbidden'); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405; response.setHeader('allow', 'GET, HEAD'); response.end('Method not allowed.'); return
    }
    let target: string
    try {
      const path = decodeURIComponent(pathname)
      if (path.includes('\0') || path.includes('\\')) throw new Error('Invalid path.')
      target = await realpath(resolve(assetRoot, `.${path === '/' ? '/index.html' : path}`))
      const pathFromRoot = relative(assetRoot, target)
      if (isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) throw new Error('outside assets')
      if (!(await stat(target)).isFile()) { response.statusCode = 404; response.end('Not found'); return }
    } catch {
      response.statusCode = 404; response.end('Not found'); return
    }
    response.setHeader('content-type', mimeType(target))
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('cache-control', target.endsWith('/index.html') || target.endsWith('\\index.html') ? 'no-store' : 'public, max-age=31536000, immutable')
    if (request.method === 'HEAD') { response.end(); return }
    const stream = createReadStream(target)
    stream.on('error', () => response.destroy())
    response.once('close', () => stream.destroy())
    stream.pipe(response)
  }
}

function allowedHost(host: string | undefined): boolean {
  try {
    const url = new URL(`http://${host}`)
    return !url.username && !url.password && url.pathname === '/' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  } catch { return false }
}

function mimeType(path: string): string {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream'
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  const child = spawn(command, [url], { stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

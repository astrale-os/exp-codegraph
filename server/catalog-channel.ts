import type { IncomingMessage, ServerResponse } from 'node:http'
import { CATALOG_BOOTSTRAP_ENDPOINT, CATALOG_EVENTS_ENDPOINT } from '../viewer-host/live.ts'
import type { CatalogRuntime } from './catalog-runtime.ts'

/** A reconnect always receives the current clock; immutable payload history stays in the runtime. */
export function createCatalogChannel(runtime: CatalogRuntime) {
  const streams = new Set<ServerResponse>()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false
  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path !== CATALOG_BOOTSTRAP_ENDPOINT && path !== CATALOG_EVENTS_ENDPOINT) {
        return runtime.handleHttp(request, response)
      }
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      if (closed) { response.statusCode = 503; response.end('Server closed.'); return true }
      if (request.method !== 'GET') {
        response.statusCode = 405
        response.setHeader('allow', 'GET')
        response.end('Method not allowed.')
        return true
      }
      if (!sameOrigin(request)) {
        response.statusCode = 403
        response.end('Forbidden')
        return true
      }
      if (path === CATALOG_BOOTSTRAP_ENDPOINT) {
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(await runtime.bootstrap()))
        return true
      }
      await runtime.initialize()
      if (closed || response.destroyed) return true
      response.setHeader('content-type', 'text/event-stream; charset=utf-8')
      response.setHeader('connection', 'keep-alive')
      response.flushHeaders()
      streams.add(response)
      const unsubscribe = runtime.subscribe((generation) => {
        // A slow reader reconnects to the latest catalog instead of retaining an unbounded queue.
        if (response.writableLength > 64 * 1_024) response.destroy()
        else response.write(`data: ${generation}\n\n`)
      })
      heartbeat ??= setInterval(() => {
        for (const stream of streams) stream.write(': keep-alive\n\n')
      }, 15_000)
      heartbeat.unref()
      response.once('close', () => {
        unsubscribe()
        streams.delete(response)
        if (!streams.size) { clearInterval(heartbeat); heartbeat = undefined }
      })
      return true
    },
    close() {
      closed = true
      clearInterval(heartbeat)
      heartbeat = undefined
      for (const stream of streams) stream.end()
      streams.clear()
    },
  }
}

function sameOrigin(request: IncomingMessage): boolean {
  if (!request.headers.origin) return true
  try { return new URL(request.headers.origin).host === request.headers.host }
  catch { return false }
}

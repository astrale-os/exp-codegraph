import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectLiveCatalog } from '../viewer/host/live.ts'
import { CATALOG_INDEX_FORMAT, CATALOG_TRANSPORT_VERSION } from '../viewer-host/catalog.ts'
import type { CatalogBootstrap } from '../viewer-host/live.ts'

class Events {
  static current: Events
  onopen?: () => void
  onmessage?: () => void
  close = vi.fn()
  constructor() { Events.current = this }
}
const closes: Array<() => void> = []
afterEach(() => { closes.splice(0).forEach((close) => close()); vi.unstubAllGlobals(); vi.useRealTimers() })
function catalog(generation: number): CatalogBootstrap {
  return {
    index: { format: CATALOG_INDEX_FORMAT, version: CATALOG_TRANSPORT_VERSION, generation: `${generation}`.padStart(64, '0'), snapshot: `application:${'0'.repeat(64)}`, specs: [], diagnostics: [] },
    adapterManifest: {}, generation,
  }
}
function defer() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve: (generation: number) => resolve(Response.json(catalog(generation))) }
}

describe('live browser catalog transport', () => {
  it('coalesces messages and opening/reconnecting, and never publishes an overtaken bootstrap', async () => {
    const first = defer(), second = defer(), third = defer()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    vi.stubGlobal('EventSource', Events)
    vi.stubGlobal('fetch', fetch)
    const mount = vi.fn(), failed = vi.fn()
    closes.push(connectLiveCatalog(mount, failed))
    expect(fetch).toHaveBeenCalledTimes(1)
    Events.current.onopen!()
    Events.current.onmessage!()
    first.resolve(1)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(mount).not.toHaveBeenCalled()
    second.resolve(2)
    await vi.waitFor(() => expect(mount).toHaveBeenCalledWith(catalog(2)))
    // Reconnection refreshes even if the server-local clock restarted at an older number.
    Events.current.onopen!()
    expect(fetch).toHaveBeenCalledTimes(3)
    third.resolve(0)
    await vi.waitFor(() => expect(mount).toHaveBeenLastCalledWith(catalog(0)))
    expect(failed).not.toHaveBeenCalled()
  })

  it('retries a failed initial bootstrap and cancels in-flight work and the stream on disposal', async () => {
    vi.useFakeTimers()
    const second = defer()
    const fetch = vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockReturnValueOnce(second.promise)
    vi.stubGlobal('EventSource', Events)
    vi.stubGlobal('fetch', fetch)
    const mount = vi.fn(), failed = vi.fn()
    const close = connectLiveCatalog(mount, failed)
    closes.push(close)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'disconnected' }))
    expect(fetch).toHaveBeenCalledTimes(2)
    close()
    expect(Events.current.close).toHaveBeenCalled()
    expect(fetch.mock.calls[1]![1].signal.aborted).toBe(true)
    second.resolve(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mount).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

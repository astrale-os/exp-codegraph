import { CATALOG_BOOTSTRAP_ENDPOINT, CATALOG_EVENTS_ENDPOINT, type CatalogBootstrap } from '../../viewer-host/live.ts'

/** One in-flight bootstrap; edits and reconnects trigger a catch-up before publishing stale data. */
export function connectLiveCatalog(
  mount: (catalog: CatalogBootstrap) => void,
  failed: (error: unknown) => void,
): () => void {
  const events = new EventSource(CATALOG_EVENTS_ENDPOINT)
  const abort = new AbortController()
  let requested = 0
  let completed = 0
  let running = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    requested++
    clearTimeout(retry)
    if (running || abort.signal.aborted) return
    running = true
    void (async () => {
      while (completed < requested && !abort.signal.aborted) {
        const target = requested
        const response = await fetch(CATALOG_BOOTSTRAP_ENDPOINT, { cache: 'no-store', signal: abort.signal })
        if (!response.ok) throw new Error(`Catalog unavailable (${response.status}).`)
        const catalog: CatalogBootstrap = await response.json()
        completed = target
        if (target === requested && !abort.signal.aborted) mount(catalog)
      }
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return
      failed(error)
      retry = setTimeout(refresh, 1_000)
    }).finally(() => { running = false })
  }
  // Opening the stream triggers a full catch-up, even when a restarted server resets its clock.
  events.onopen = refresh
  events.onmessage = refresh
  refresh()
  return () => {
    abort.abort()
    events.close()
    clearTimeout(retry)
  }
}

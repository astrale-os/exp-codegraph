import { useCallback, useEffect, useState } from 'preact/hooks'

import type { Route, ViewerRouteView } from './route.ts'

import { readRoute, viewerRouteHref } from './route.ts'

const HISTORY_MARKER = 'astrale.spec.viewer.v1'
const MAX_INDEX_PREFIX = 'astrale.spec.viewer.max.'

interface HistoryEntry {
  marker: typeof HISTORY_MARKER
  session: string
  index: number
  scrollY: number
}

interface NavigationState {
  route: Route
  index: number
  maxIndex: number
}

export interface ViewerHistory {
  route: Route
  canGoBack: boolean
  canGoForward: boolean
  navigate(
    route: Route & ({ source: string } | { view: ViewerRouteView }),
    options?: { replace?: boolean; scroll?: boolean },
  ): void
  back(): void
  forward(): void
}

export function useViewerHistory(): ViewerHistory {
  const [navigation, setNavigation] = useState<NavigationState>(initialize)

  const saveScroll = useCallback(() => {
    const entry = historyEntry(history.state)
    if (!entry) return
    history.replaceState({ ...entry, scrollY: window.scrollY }, '', location.href)
  }, [])

  useEffect(() => {
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    let frame: number | undefined
    const recordScroll = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        saveScroll()
      })
    }
    const restore = (scrollY: number) => {
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollY)))
    }
    const pop = (event: PopStateEvent) => {
      const entry = historyEntry(event.state)
      if (!entry) return
      const maximum = Math.max(entry.index, readMaxIndex(entry.session, entry.index))
      setNavigation({ route: readRoute(location), index: entry.index, maxIndex: maximum })
      restore(entry.scrollY)
    }

    window.addEventListener('scroll', recordScroll, { passive: true })
    window.addEventListener('popstate', pop)
    window.addEventListener('pagehide', saveScroll)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      history.scrollRestoration = previousRestoration
      window.removeEventListener('scroll', recordScroll)
      window.removeEventListener('popstate', pop)
      window.removeEventListener('pagehide', saveScroll)
    }
  }, [saveScroll])

  const navigate = useCallback<ViewerHistory['navigate']>(
    (route, options = {}) => {
      const href = viewerRouteHref(route)
      const replace = options.replace ?? false
      const scroll = options.scroll ?? !replace
      const current = historyEntry(history.state)
      if (location.search === href) {
        setNavigation((value) => ({ ...value, route }))
        return
      }

      saveScroll()
      if (replace) {
        const entry = current ?? createEntry(0, window.scrollY)
        history.replaceState({ ...entry, scrollY: scroll ? 0 : window.scrollY }, '', href)
        setNavigation((value) => ({ ...value, route }))
      } else {
        const index = (current?.index ?? navigation.index) + 1
        const entry = createEntry(index, 0, current?.session)
        writeMaxIndex(entry.session, index)
        history.pushState(entry, '', href)
        setNavigation({ route, index, maxIndex: index })
      }
      if (scroll) requestAnimationFrame(() => window.scrollTo(0, 0))
    },
    [navigation.index, saveScroll],
  )

  return {
    route: navigation.route,
    canGoBack: navigation.index > 0,
    canGoForward: navigation.index < navigation.maxIndex,
    navigate,
    back: () => {
      saveScroll()
      history.back()
    },
    forward: () => {
      saveScroll()
      history.forward()
    },
  }
}

function initialize(): NavigationState {
  let entry = historyEntry(history.state)
  if (!entry) {
    entry = createEntry(0, window.scrollY)
    history.replaceState(entry, '', location.href)
  }
  const maxIndex = readMaxIndex(entry.session, entry.index)
  writeMaxIndex(entry.session, maxIndex)
  return { route: readRoute(location), index: entry.index, maxIndex }
}

function createEntry(index: number, scrollY: number, session = sessionId()): HistoryEntry {
  return { marker: HISTORY_MARKER, session, index, scrollY }
}

function historyEntry(value: unknown): HistoryEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const input = value as Record<string, unknown>
  if (
    input.marker !== HISTORY_MARKER ||
    typeof input.session !== 'string' ||
    !input.session ||
    !Number.isSafeInteger(input.index) ||
    Number(input.index) < 0 ||
    typeof input.scrollY !== 'number' ||
    !Number.isFinite(input.scrollY) ||
    input.scrollY < 0
  ) {
    return
  }
  return {
    marker: HISTORY_MARKER,
    session: input.session,
    index: Number(input.index),
    scrollY: input.scrollY,
  }
}

function sessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function readMaxIndex(session: string, fallback: number): number {
  try {
    const value = Number(sessionStorage.getItem(`${MAX_INDEX_PREFIX}${session}`))
    return Number.isSafeInteger(value) && value >= fallback ? value : fallback
  } catch {
    return fallback
  }
}

function writeMaxIndex(session: string, index: number): void {
  try {
    sessionStorage.setItem(`${MAX_INDEX_PREFIX}${session}`, String(index))
  } catch {
    // History remains functional when session storage is unavailable.
  }
}

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { CatalogIndex, CatalogSpecEntry } from '../../viewer-host/catalog.ts'
import type { ViewerQualification } from '../../viewer-host/qualification.ts'
import type { ViewerAdapters } from '../host/adapters.ts'
import type { CatalogLoader } from '../host/catalog.ts'
import type { ApiDefinitionOwner, ApiNavigationState } from '../specification/api.tsx'
import type { SpecTab } from './route.ts'

import { catalogSpecMetrics } from '../../viewer-host/catalog.ts'
import { useCatalogSelection } from '../host/catalog-state.ts'
import {
  createModuleTopologyIndex,
  hasModuleTopology,
} from '../specification/module-topology-model.ts'
import { moduleNavigationTab, selectedSpecTab, specTabs } from '../specification/tabs.ts'
import { SpecView } from '../specification/view.tsx'
import { ArchitectureOverview } from './architecture.tsx'
import { useViewerHistory } from './history.ts'
import { Navigation } from './navigation.tsx'
import { readRoute } from './route.ts'

interface AppProps {
  adapters: ViewerAdapters
  index: CatalogIndex
  loader: CatalogLoader
}

interface LocalVerification {
  revision: string
  value: ViewerQualification
}

const CATALOG_PROGRESS_DELAY_MS = 180
const CATALOG_PROGRESS_FINISH_MS = 260
type CatalogProgressPhase = 'complete' | 'hidden' | 'loading'

export function App({ adapters, index, loader }: AppProps) {
  const navigation = useViewerHistory()
  const [rememberedTabs, setRememberedTabs] = useState<Record<string, SpecTab | undefined>>({})
  const [rememberedApiNavigation, setRememberedApiNavigation] = useState<
    Record<string, ApiNavigationState | undefined>
  >({})
  const [localVerifications, setLocalVerifications] = useState<
    Record<string, LocalVerification | undefined>
  >({})
  const route = navigation.route
  const selection = useCatalogSelection(index, loader, route.source, route.view === 'graph')
  const selected = useMemo(() => {
    const spec = selection.spec
    if (!spec) return
    const local = localVerifications[spec.source]
    return !spec.verification && local?.revision === spec.verificationRevision
      ? { ...spec, verification: local.value }
      : spec
  }, [localVerifications, selection.spec])
  const navigationSpecs = useMemo(
    () =>
      selection.index.specs.map((entry) =>
        selected?.source === entry.source
          ? { ...entry, metrics: catalogSpecMetrics(selected) }
          : entry,
      ),
    [selected, selection.index.specs],
  )
  const apiDefinitionOwners = useMemo(() => {
    const owners = new Map<string, ApiDefinitionOwner>()
    for (const entry of selection.index.specs) {
      for (const identity of entry.apiDeclarationIdentities ?? []) {
        owners.set(identity, { source: entry.source, title: entry.title })
      }
    }
    return owners
  }, [selection.index.specs])
  const topologyIndex = useMemo(
    () => createModuleTopologyIndex(selection.index.specs),
    [selection.index.specs],
  )
  const pointer = selected?.source === route.source ? route.pointer : undefined
  const topologyAvailable = selected ? hasModuleTopology(topologyIndex, selected.source) : false
  const tab = selected
    ? selectedSpecTab(selected, route, rememberedTabs[selected.source], {
        code: topologyAvailable,
      })
    : undefined
  const requestedEntry =
    selection.index.specs.find((entry) => entry.source === route.source) ?? selection.entry
  const transitioning =
    route.view !== 'graph' &&
    (selection.pending ||
      (!selection.error && !!requestedEntry && selected?.source !== requestedEntry.source))

  useEffect(() => {
    if (route.view === 'graph') {
      document.title = 'System map — Specifications'
      return
    }
    if (!selected || !tab) return
    // The selected Spec is intentionally kept visible while a different route target loads.
    // Do not let that previous Spec canonicalize the URL back to itself before the atomic swap.
    if (isCatalogTransitionTarget(selection.index.specs, route.source, selected.source)) return
    setRememberedTabs((current) =>
      current[selected.source] === tab ? current : { ...current, [selected.source]: tab },
    )
    if (route.source !== selected.source || route.pointer !== pointer || route.tab !== tab) {
      navigation.navigate(
        { source: selected.source, pointer, tab, resource: route.resource, api: route.api },
        { replace: true, scroll: false },
      )
    }
    document.title = `${selected.title} — Specifications`
  }, [
    navigation.navigate,
    pointer,
    route.pointer,
    route.resource,
    route.source,
    route.tab,
    route.view,
    selected,
    selection.index.specs,
    tab,
  ])

  const navigateFromLink = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const origin = event.target
    if (!(origin instanceof Element)) return
    const anchor = origin.closest('a[href]') as HTMLAnchorElement | null
    if (
      !anchor ||
      anchor.hasAttribute('download') ||
      (anchor.target && anchor.target !== '_self')
    ) {
      return
    }
    const url = new URL(anchor.href, location.href)
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash) return
    const target = readRoute(url)
    if (target.view === 'graph') {
      event.preventDefault()
      navigation.navigate({ view: 'graph' })
      return
    }
    if (!target.source) return
    const specification = selection.index.specs.find((spec) => spec.source === target.source)
    if (!specification) return
    event.preventDefault()
    const destinationTab = moduleNavigationTab(
      target.tab,
      tab,
      rememberedTabs[specification.source],
    )
    const api =
      target.api ??
      (destinationTab === 'api' ? rememberedApiNavigation[specification.source] : undefined)
    navigation.navigate({
      ...target,
      source: specification.source,
      tab: destinationTab,
      api,
    })
  }

  return (
    <div class="app-shell" onClick={navigateFromLink}>
      <CatalogProgress active={transitioning} title={requestedEntry?.title} />
      <Navigation
        specs={navigationSpecs}
        active={
          route.view === 'graph'
            ? undefined
            : transitioning
              ? requestedEntry?.source
              : selection.entry?.source
        }
        view={route.view}
        canGoBack={navigation.canGoBack}
        canGoForward={navigation.canGoForward}
        onBack={navigation.back}
        onForward={navigation.forward}
        onSpecPrefetch={(entry) => {
          if (entry.source === selected?.source) return
          void loader.load(entry).catch(() => undefined)
        }}
        onSpecSectionsRequest={(entry) =>
          loader
            .load(entry)
            .then((spec) =>
              specTabs(spec, { code: hasModuleTopology(topologyIndex, entry.source) }),
            )
        }
      />
      <main class="main" tabindex={-1} aria-busy={transitioning}>
        {selection.index.diagnostics.length > 0 && (
          <section class="catalog-errors" aria-label="Catalog errors">
            {selection.index.diagnostics.map((diagnostic) => (
              <p key={`${diagnostic.code}:${diagnostic.message}`}>
                <strong>{diagnostic.code}</strong> {diagnostic.message}
              </p>
            ))}
          </section>
        )}
        {route.view !== 'graph' && selection.error && (
          <section class="catalog-errors" role="alert" aria-label="Catalog loading error">
            <p>
              <strong>CATALOG_PAYLOAD_FAILED</strong> {selection.error}
            </p>
          </section>
        )}
        {route.view !== 'graph' && selected?.payloadDiagnostics?.length ? (
          <section class="catalog-errors" role="status" aria-label="Catalog payload warnings">
            {selected.payloadDiagnostics.map((diagnostic) => (
              <p key={`${diagnostic.code}:${diagnostic.file}:${diagnostic.message}`}>
                <strong>{diagnostic.code}</strong> {diagnostic.message} Raw declaration text remains
                available.
              </p>
            ))}
          </section>
        ) : null}
        {route.view === 'graph' ? (
          <ArchitectureOverview specs={navigationSpecs} />
        ) : selected ? (
          <SpecView
            key={selected.source}
            spec={selected}
            topologyIndex={topologyIndex}
            tab={tab!}
            pointer={pointer}
            revealAdapter={adapters.reveal}
            sourceEditAdapter={adapters.editing}
            verificationAdapter={adapters.verification}
            apiNavigation={route.api ?? rememberedApiNavigation[selected.source]}
            resourceSource={route.resource}
            apiDefinitionOwners={apiDefinitionOwners}
            onApiDefinitionOpen={(target) => {
              setRememberedApiNavigation((current) => ({
                ...current,
                [target.owner.source]: target.navigation,
              }))
              navigation.navigate({
                source: target.owner.source,
                tab: 'api',
                api: target.navigation,
              })
            }}
            onTabChange={(nextTab) => {
              setRememberedTabs((current) => ({ ...current, [selected.source]: nextTab }))
              navigation.navigate(
                {
                  source: selected.source,
                  pointer,
                  tab: nextTab,
                  resource: undefined,
                  api: route.api ?? rememberedApiNavigation[selected.source],
                },
                { replace: true, scroll: false },
              )
            }}
            onResourceChange={(nextTab, resource) => {
              setRememberedTabs((current) => ({ ...current, [selected.source]: nextTab }))
              navigation.navigate({
                source: selected.source,
                pointer,
                tab: nextTab,
                resource,
                api: route.api ?? rememberedApiNavigation[selected.source],
              })
            }}
            onApiNavigationChange={(apiNavigation, history, previous) => {
              setRememberedApiNavigation((current) => ({
                ...current,
                [selected.source]: apiNavigation,
              }))
              if (history === 'push' && !sameApiNavigation(route.api, previous)) {
                navigation.navigate(
                  { source: selected.source, pointer, tab: 'api', api: previous },
                  { replace: true, scroll: false },
                )
              }
              navigation.navigate(
                { source: selected.source, pointer, tab: 'api', api: apiNavigation },
                { replace: history === 'replace', scroll: false },
              )
            }}
            onVerification={(verification) =>
              setLocalVerifications((current) => ({
                ...current,
                [selected.source]: {
                  revision: selected.verificationRevision,
                  value: verification,
                },
              }))
            }
          />
        ) : selection.pending ? (
          <section class="empty-state">
            <p class="eyebrow">Loading</p>
            <h1>Opening specification</h1>
          </section>
        ) : (
          <section class="empty-state">
            <p class="eyebrow">Catalog empty</p>
            <h1>No specifications found</h1>
            <p>
              Add a <code>.spec/api.d.ts</code> module contract.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

export function isCatalogTransitionTarget(
  entries: readonly CatalogSpecEntry[],
  routeSource: string | undefined,
  selectedSource: string,
): boolean {
  return routeSource !== selectedSource && entries.some((entry) => entry.source === routeSource)
}

function CatalogProgress({ active, title }: { active: boolean; title?: string }) {
  const [phase, setPhase] = useState<CatalogProgressPhase>('hidden')
  const phaseRef = useRef(phase)
  const startedAt = useRef(0)
  const bar = useRef<HTMLSpanElement>(null)
  const label = `Loading ${title ?? 'specification'}`
  phaseRef.current = phase

  useEffect(() => {
    let timer: number | undefined
    if (active) {
      startedAt.current = performance.now()
      setPhase('hidden')
      timer = window.setTimeout(() => setPhase('loading'), CATALOG_PROGRESS_DELAY_MS)
    } else if (phaseRef.current === 'loading') {
      setPhase('complete')
      timer = window.setTimeout(() => setPhase('hidden'), CATALOG_PROGRESS_FINISH_MS)
    } else {
      setPhase('hidden')
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [active])

  useEffect(() => {
    if (phase !== 'loading') return
    let frame = 0
    const update = (now: number) => {
      bar.current?.style.setProperty(
        '--catalog-progress-value',
        String(estimatedCatalogProgress(now - startedAt.current)),
      )
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [phase])

  return (
    <>
      {phase !== 'hidden' && (
        <div class="catalog-progress" data-phase={phase} role="progressbar" aria-label={label}>
          <span ref={bar} aria-hidden="true" />
        </div>
      )}
      <span class="sr-only" role="status" aria-live="polite">
        {active ? `${label}…` : ''}
      </span>
    </>
  )
}

export function estimatedCatalogProgress(elapsedMs: number): number {
  if (Number.isNaN(elapsedMs) || elapsedMs <= 0) return 0.03
  if (!Number.isFinite(elapsedMs)) return 0.99
  if (elapsedMs <= 1_000) return progressRange(elapsedMs, 0, 1_000, 0.03, 0.25)
  if (elapsedMs <= 8_000) return progressRange(elapsedMs, 1_000, 8_000, 0.25, 0.68)
  if (elapsedMs <= 30_000) return progressRange(elapsedMs, 8_000, 30_000, 0.68, 0.91)
  return 0.91 + 0.08 * (1 - Math.exp(-(elapsedMs - 30_000) / 90_000))
}

function progressRange(
  elapsedMs: number,
  startMs: number,
  endMs: number,
  start: number,
  end: number,
): number {
  const position = (elapsedMs - startMs) / (endMs - startMs)
  const eased = 1 - (1 - position) ** 3
  return start + (end - start) * eased
}

function sameApiNavigation(
  left: ApiNavigationState | undefined,
  right: ApiNavigationState,
): boolean {
  if (!left || left.source !== right.source || left.declaration !== right.declaration) return false
  if (left.expanded.length !== right.expanded.length) return false
  return left.expanded.every((path, index) => path === right.expanded[index])
}

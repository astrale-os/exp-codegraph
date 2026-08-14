import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { CatalogSpecEntry, CatalogSpecMetrics } from '../../viewer-host/catalog.ts'
import type {
  NavigationFolderNode,
  NavigationModuleNode,
  NavigationNode,
} from './navigation-model.ts'
import type { NavigationBreadcrumb, NavigationFamily } from './navigation-scope.ts'
import type { NavigationSearchEntry, NavigationSearchResult } from './navigation-search.ts'

import { ModuleIcon } from './module-icon.tsx'
import { buildNavigationTree, navigationExpansionKeys } from './navigation-model.ts'
import {
  buildNavigationFamilies,
  navigationBreadcrumb,
  navigationFamilyForSource,
  navigationFamilyModules,
} from './navigation-scope.ts'
import {
  addRecentNavigationSource,
  buildNavigationSearchIndex,
  searchNavigationIndex,
  togglePinnedNavigationSource,
} from './navigation-search.ts'
import { graphRouteHref, routeHref, type SpecTab, type ViewerRouteView } from './route.ts'

const PREFETCH_INTENT_DELAY_MS = 140
const NAVIGATION_SCROLL_INSET_PX = 6
const SWITCHER_SEARCH_LIMIT = 200
const SWITCHER_FALLBACK_LIMIT = 40
const RECENT_MODULES_KEY = 'astrale.spec.viewer.recent-modules.v1'
const PINNED_MODULES_KEY = 'astrale.spec.viewer.pinned-modules.v1'
const NAVIGATION_MODE_KEY = 'astrale.spec.viewer.navigation-mode.v1'
const FAMILY_LOCATIONS_KEY = 'astrale.spec.viewer.family-locations.v1'

interface NavigationProps {
  specs: readonly CatalogSpecEntry[]
  active?: string
  view?: ViewerRouteView
  canGoBack: boolean
  canGoForward: boolean
  onBack(): void
  onForward(): void
  onSpecPrefetch?(spec: CatalogSpecEntry): void
  onSpecSectionsRequest?(spec: CatalogSpecEntry): Promise<readonly SpecTab[]>
}

interface NavigationNodesProps {
  nodes: NavigationNode[]
  active?: string
  depth: number
  expansionMode: 'family' | 'all'
  expanded: Record<string, boolean | undefined>
  setExpanded(key: string, value: boolean): void
}

interface PrefetchControls {
  schedule(spec: CatalogSpecEntry): void
  cancel(): void
  now(spec: CatalogSpecEntry): void
}

interface ModuleSwitcherGroup {
  label: string
  entries: readonly NavigationSearchEntry[]
}

export function Navigation({
  specs,
  active,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSpecPrefetch,
  onSpecSectionsRequest,
  view,
}: NavigationProps) {
  const [query, setQuery] = useState('')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [activeResult, setActiveResult] = useState(0)
  const [showRelated, setShowRelated] = useState(false)
  const [sectionsBySource, setSectionsBySource] = useState<
    Record<string, readonly SpecTab[] | null | undefined>
  >({})
  const [loadingSectionsSource, setLoadingSectionsSource] = useState<string>()
  const [recentSources, setRecentSources] = useState<string[]>(() =>
    readStoredSources(RECENT_MODULES_KEY),
  )
  const [pinnedSources, setPinnedSources] = useState<string[]>(() =>
    readStoredSources(PINNED_MODULES_KEY),
  )
  const [expanded, setExpanded] = useState<Record<string, boolean | undefined>>({})
  const [navigationMode, setNavigationMode] = useState<'scoped' | 'all'>(() => readNavigationMode())
  const [browsedFamily, setBrowsedFamily] = useState<string>()
  const [familyLocations, setFamilyLocations] = useState<Record<string, string>>(() =>
    readFamilyLocations(),
  )
  const [breadcrumbOpen, setBreadcrumbOpen] = useState(false)
  const navigation = useRef<HTMLElement>(null)
  const switcher = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const activeOption = useRef<HTMLAnchorElement>(null)
  const returnFocus = useRef<HTMLElement>()
  const breadcrumbMenu = useRef<HTMLDivElement>(null)
  const prefetch = useSpecPrefetch(active, onSpecPrefetch)
  const tree = useMemo(() => buildNavigationTree(specs), [specs])
  const families = useMemo(() => buildNavigationFamilies(tree), [tree])
  const activeFamily = navigationFamilyForSource(active)
  const scopedFamily =
    families.find((family) => family.name === browsedFamily) ??
    families.find((family) => family.name === activeFamily) ??
    families[0]
  const activeBreadcrumb = useMemo(() => navigationBreadcrumb(specs, active), [active, specs])
  const scopedBreadcrumb =
    scopedFamily?.name === activeFamily && activeBreadcrumb
      ? activeBreadcrumb
      : scopedFamily
        ? {
            name: scopedFamily.name,
            iconSpec: scopedFamily.identitySpec,
            siblings: navigationFamilyModules(scopedFamily, 'children'),
          }
        : undefined
  const searchIndex = useMemo(() => buildNavigationSearchIndex(specs), [specs])
  const ranked = useMemo(
    () => searchNavigationIndex(searchIndex, query, recentSources, SWITCHER_SEARCH_LIMIT),
    [query, recentSources, searchIndex],
  )
  const groups = useMemo(
    () =>
      switcherGroups(searchIndex, ranked.items, query, pinnedSources, recentSources, showRelated),
    [pinnedSources, query, ranked.items, recentSources, searchIndex, showRelated],
  )
  const directCount = query.trim() ? ranked.items.filter((result) => result.direct).length : 0
  const relatedCount = directCount ? Math.max(ranked.total - directCount, 0) : 0
  const exactSectionEntry =
    directCount === 1 ? ranked.items.find((result) => result.direct)?.entry : undefined
  const exactSectionState = exactSectionEntry
    ? sectionsBySource[exactSectionEntry.spec.source]
    : undefined
  const exactSectionTabs = exactSectionState ?? undefined
  const targetTab =
    ranked.query.tab &&
    exactSectionTabs !== undefined &&
    !exactSectionTabs.includes(ranked.query.tab)
      ? undefined
      : ranked.query.tab
  const results = groups.flatMap((group) => group.entries)
  const selectedIndex = Math.min(activeResult, Math.max(results.length - 1, 0))
  const selectedResult = results[selectedIndex]
  const activeExpansionState = active
    ? navigationExpansionKeys(active)
        .map((key) => (expanded[key] === true ? 'open' : expanded[key] === false ? 'closed' : ''))
        .join('|')
    : ''
  useEffect(() => {
    if (!active) return
    const ancestors = navigationExpansionKeys(active)
    setExpanded((current) => {
      if (ancestors.every((key) => current[key] === true)) return current
      const next = { ...current }
      for (const key of ancestors) next[key] = true
      return next
    })
  }, [active])
  useEffect(() => {
    if (!activeFamily || !active) return
    setBrowsedFamily(activeFamily)
    setFamilyLocations((current) => {
      if (current[activeFamily] === active) return current
      const next = { ...current, [activeFamily]: active }
      writeFamilyLocations(next)
      return next
    })
  }, [active, activeFamily])
  useEffect(() => setBreadcrumbOpen(false), [active, browsedFamily, navigationMode])
  useEffect(() => {
    if (!breadcrumbOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !breadcrumbMenu.current?.contains(event.target)) {
        setBreadcrumbOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [breadcrumbOpen])
  useEffect(() => {
    if (!active) return
    setRecentSources((current) => {
      const next = addRecentNavigationSource(current, active)
      writeStoredSources(RECENT_MODULES_KEY, next)
      return sameSources(current, next) ? current : next
    })
  }, [active])
  useEffect(() => {
    setActiveResult(0)
    setShowRelated(false)
  }, [query, switcherOpen])
  useEffect(() => {
    if (!switcherOpen || !exactSectionEntry || !onSpecSectionsRequest) return
    const source = exactSectionEntry.spec.source
    if (sectionsBySource[source] !== undefined || loadingSectionsSource === source) return
    setLoadingSectionsSource(source)
    void onSpecSectionsRequest(exactSectionEntry.spec)
      .then((tabs) =>
        setSectionsBySource((current) =>
          current[source] === undefined ? { ...current, [source]: tabs } : current,
        ),
      )
      .catch(() =>
        setSectionsBySource((current) =>
          current[source] === undefined ? { ...current, [source]: null } : current,
        ),
      )
      .finally(() =>
        setLoadingSectionsSource((current) => (current === source ? undefined : current)),
      )
  }, [
    exactSectionEntry,
    loadingSectionsSource,
    onSpecSectionsRequest,
    sectionsBySource,
    switcherOpen,
  ])
  useEffect(() => {
    if (!switcherOpen) return
    const frame = requestAnimationFrame(() =>
      activeOption.current?.scrollIntoView({ block: 'nearest' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [activeResult, query, switcherOpen])
  useEffect(() => {
    const openFromKeyboard = (event: KeyboardEvent) => {
      const shortcut = (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k'
      if (!shortcut) return
      event.preventDefault()
      if (
        !document.querySelector('.command-palette') &&
        document.activeElement instanceof HTMLElement
      ) {
        returnFocus.current = document.activeElement
      }
      setSwitcherOpen(true)
      requestAnimationFrame(() => searchInput.current?.focus())
    }
    document.addEventListener('keydown', openFromKeyboard)
    return () => document.removeEventListener('keydown', openFromKeyboard)
  }, [])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = navigation.current
      const selected = container?.querySelector<HTMLElement>(
        '[data-spec-source][aria-current="page"]',
      )
      if (!container || !selected) return
      const containerBounds = container.getBoundingClientRect()
      const selectedBounds = selected.getBoundingClientRect()
      const visibleTop = containerBounds.top + NAVIGATION_SCROLL_INSET_PX
      const visibleBottom = containerBounds.bottom - NAVIGATION_SCROLL_INSET_PX
      if (selectedBounds.top < visibleTop) {
        container.scrollTop -= visibleTop - selectedBounds.top
      } else if (selectedBounds.bottom > visibleBottom) {
        container.scrollTop += selectedBounds.bottom - visibleBottom
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, activeExpansionState])
  const remember = (source: string) => {
    setRecentSources((current) => {
      const next = addRecentNavigationSource(current, source)
      writeStoredSources(RECENT_MODULES_KEY, next)
      return sameSources(current, next) ? current : next
    })
  }
  const togglePin = (source: string) => {
    setPinnedSources((current) => {
      const next = togglePinnedNavigationSource(current, source)
      writeStoredSources(PINNED_MODULES_KEY, next)
      return next
    })
  }
  const dismissSwitcher = () => {
    setSwitcherOpen(false)
    setQuery('')
    requestAnimationFrame(() => returnFocus.current?.focus())
  }
  const openSelected = (newTab: boolean) => {
    if (!selectedResult) return
    remember(selectedResult.spec.source)
    if (newTab) {
      window.open(
        routeHref(selectedResult.spec.source, undefined, targetTab),
        '_blank',
        'noopener,noreferrer',
      )
      return
    }
    activeOption.current?.click()
  }

  return (
    <aside class="sidebar">
      <header class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 4.5h8l3 3V19.5H7z" />
            <path d="M15 4.5v3h3M4 7.5v12h11M10 11h5M10 14.5h5" />
          </svg>
        </span>
        <span class="brand-copy">
          <strong>Specifications</strong>
          <small>{specs.length} specifications</small>
        </span>
        <span class="history-controls" aria-label="Specification history">
          <button
            type="button"
            aria-label="Back"
            title="Back"
            disabled={!canGoBack}
            onClick={onBack}
          >
            <HistoryArrow direction="back" />
          </button>
          <button
            type="button"
            aria-label="Forward"
            title="Forward"
            disabled={!canGoForward}
            onClick={onForward}
          >
            <HistoryArrow direction="forward" />
          </button>
        </span>
      </header>
      <div class="module-switcher">
        {switcherOpen && (
          <div
            class="command-palette-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) dismissSwitcher()
            }}
          >
            <div
              ref={switcher}
              class="command-palette"
              role="dialog"
              aria-modal="true"
              aria-label="Open a specification module or section"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  dismissSwitcher()
                  return
                }
                trapCommandPaletteFocus(event)
              }}
            >
              <label class="search command-palette-search" data-open="true">
                <span class="sr-only">Find and open a specification module or section</span>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" />
                  <path d="m13 13 4 4" />
                </svg>
                <input
                  ref={searchInput}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="module-switcher-results"
                  aria-activedescendant={
                    selectedResult ? `module-switcher-option-${selectedIndex}` : undefined
                  }
                  aria-autocomplete="list"
                  autocomplete="off"
                  spellcheck={false}
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setActiveResult((current) =>
                        Math.min(current + 1, Math.max(results.length - 1, 0)),
                      )
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setActiveResult((current) => Math.max(current - 1, 0))
                    } else if (event.key === 'Home') {
                      event.preventDefault()
                      setActiveResult(0)
                    } else if (event.key === 'End') {
                      event.preventDefault()
                      setActiveResult(Math.max(results.length - 1, 0))
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      openSelected(event.metaKey || event.ctrlKey)
                    }
                  }}
                  placeholder="Search modules and sections…"
                />
                <kbd aria-hidden="true">esc</kbd>
              </label>
              <ModuleSwitcherPanel
                groups={groups}
                query={query}
                queryTerms={ranked.query.terms}
                total={ranked.total}
                directCount={directCount}
                relatedCount={relatedCount}
                showRelated={showRelated}
                selected={selectedIndex}
                pinnedSources={pinnedSources}
                targetTab={targetTab}
                requestedTab={ranked.query.tab}
                sectionEntry={exactSectionEntry}
                sectionTabs={exactSectionTabs}
                sectionsLoading={exactSectionEntry?.spec.source === loadingSectionsSource}
                activeOption={activeOption}
                onSelect={(source) => {
                  queueMicrotask(() => {
                    remember(source)
                    setSwitcherOpen(false)
                    setQuery('')
                  })
                }}
                onHighlight={setActiveResult}
                onToggleRelated={() => setShowRelated((current) => !current)}
                onTogglePin={togglePin}
                prefetch={prefetch}
              />
            </div>
          </div>
        )}
      </div>
      <nav
        ref={navigation}
        aria-label="Specification explorer"
        onPointerOver={(event) => {
          const spec = specForTarget(event.target, specs)
          if (spec) prefetch.schedule(spec)
        }}
        onPointerOut={(event) => {
          if (specSource(event.target) !== specSource(event.relatedTarget)) prefetch.cancel()
        }}
        onFocusCapture={(event) => {
          const spec = specForTarget(event.target, specs)
          if (spec) prefetch.now(spec)
        }}
      >
        <div class="nav-scope-toolbar">
          <NavigationScopeBreadcrumb
            breadcrumb={view === 'graph' ? { name: 'System map', siblings: [] } : scopedBreadcrumb}
            graph={view === 'graph'}
            open={breadcrumbOpen}
            menuRef={breadcrumbMenu}
            active={active}
            onToggle={() => setBreadcrumbOpen((current) => !current)}
            onSelect={() => setBreadcrumbOpen(false)}
          />
          <button
            type="button"
            class="nav-mode-toggle"
            aria-pressed={navigationMode === 'all'}
            onClick={() => {
              const next = navigationMode === 'scoped' ? 'all' : 'scoped'
              setNavigationMode(next)
              writeNavigationMode(next)
            }}
          >
            {navigationMode === 'scoped' ? 'Show all' : 'Focus'}
          </button>
        </div>
        <div class="nav-scope-layout" data-mode={navigationMode}>
          <NavigationFamilyRail
            families={families}
            activeFamily={activeFamily}
            browsedFamily={scopedFamily?.name}
            graphActive={view === 'graph'}
            allActive={navigationMode === 'all'}
            familyLocations={familyLocations}
            onBrowse={(family) => {
              setBrowsedFamily(family)
              setNavigationMode('scoped')
              writeNavigationMode('scoped')
            }}
            onShowAll={() => {
              setNavigationMode('all')
              writeNavigationMode('all')
            }}
          />
          <div class="nav-scope-tree">
            <NavigationNodes
              nodes={
                navigationMode === 'all'
                  ? tree.nodes
                  : scopedFamily
                    ? scopedFamilyNodes(scopedFamily)
                    : []
              }
              active={active}
              depth={0}
              expansionMode={navigationMode === 'all' ? 'all' : 'family'}
              expanded={expanded}
              setExpanded={(key, value) => setExpanded((current) => ({ ...current, [key]: value }))}
            />
          </div>
        </div>
      </nav>
      <footer class="sidebar-footer">
        <span class="live-dot" aria-hidden="true" /> Live workspace
      </footer>
    </aside>
  )
}

function NavigationScopeBreadcrumb({
  breadcrumb,
  graph,
  open,
  menuRef,
  active,
  onToggle,
  onSelect,
}: {
  breadcrumb?: NavigationBreadcrumb
  graph: boolean
  open: boolean
  menuRef: { current: HTMLDivElement | null }
  active?: string
  onToggle(): void
  onSelect(): void
}) {
  if (!breadcrumb) return <span class="nav-scope-empty">No modules</span>
  const hasSiblings = breadcrumb.siblings.length > 1
  return (
    <div class="nav-scope-breadcrumb" ref={menuRef}>
      <button
        type="button"
        class="nav-scope-current"
        aria-expanded={hasSiblings ? open : undefined}
        aria-haspopup={hasSiblings ? 'menu' : undefined}
        disabled={!hasSiblings}
        onClick={onToggle}
      >
        <span class="nav-scope-current-icon" aria-hidden="true">
          {graph ? <ArchitectureGraphIcon /> : <ModuleIcon icon={breadcrumb.iconSpec?.icon} />}
        </span>
        <span class="nav-scope-current-copy">
          {breadcrumb.context && <small translate={false}>{breadcrumb.context}</small>}
          <strong translate={false}>{breadcrumb.name}</strong>
        </span>
        {hasSiblings && <ScopeMenuChevron />}
      </button>
      {open && hasSiblings && (
        <div class="nav-sibling-menu" role="menu" aria-label={`${breadcrumb.name} siblings`}>
          <header>Same owner</header>
          {breadcrumb.siblings.map((sibling) => (
            <a
              key={sibling.spec.source}
              role="menuitem"
              href={routeHref(sibling.spec.source)}
              aria-current={active === sibling.spec.source ? 'page' : undefined}
              data-spec-source={sibling.spec.source}
              onClick={onSelect}
            >
              <ModuleIcon icon={sibling.spec.icon} />
              <span>
                <strong translate={false}>{sibling.name}</strong>
                {sibling.context && <small translate={false}>{sibling.context}</small>}
              </span>
              {active === sibling.spec.source && <CurrentCheck />}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function NavigationFamilyRail({
  families,
  activeFamily,
  browsedFamily,
  graphActive,
  allActive,
  familyLocations,
  onBrowse,
  onShowAll,
}: {
  families: readonly NavigationFamily[]
  activeFamily?: string
  browsedFamily?: string
  graphActive: boolean
  allActive: boolean
  familyLocations: Readonly<Record<string, string | undefined>>
  onBrowse(family: string): void
  onShowAll(): void
}) {
  return (
    <div class="nav-family-rail" aria-label="Architecture families">
      <a
        class="nav-family-button nav-family-graph"
        href={graphRouteHref()}
        aria-label="Open system map"
        title="System map"
        aria-current={graphActive ? 'page' : undefined}
        data-label="System map"
      >
        <ArchitectureGraphIcon />
      </a>
      <span class="nav-family-divider" aria-hidden="true" />
      <div class="nav-family-list">
        {families.map((family) => {
          const remembered = familyLocations[family.name]
          const target =
            remembered && family.specs.some((spec) => spec.source === remembered)
              ? remembered
              : family.identitySpec.source
          return (
            <a
              key={family.key}
              class="nav-family-button"
              href={routeHref(target)}
              data-spec-source={target}
              aria-label={`Browse ${family.name} modules`}
              title={family.name}
              aria-current={activeFamily === family.name && !graphActive ? 'location' : undefined}
              data-browsed={browsedFamily === family.name && !allActive ? 'true' : undefined}
              data-active={activeFamily === family.name ? 'true' : undefined}
              data-label={family.name}
              onClick={() => onBrowse(family.name)}
            >
              <ModuleIcon icon={family.identitySpec.icon} />
              {family.metrics.errors > 0 && (
                <span class="nav-family-alert" aria-label={`${family.metrics.errors} errors`}>
                  {family.metrics.errors > 9 ? '9+' : family.metrics.errors}
                </span>
              )}
            </a>
          )
        })}
      </div>
      <button
        type="button"
        class="nav-family-button nav-family-all"
        aria-label="Show the full module tree"
        title="Show all"
        aria-pressed={allActive}
        data-label="Show all"
        onClick={onShowAll}
      >
        <FullTreeIcon />
      </button>
    </div>
  )
}

function scopedFamilyNodes(family: NavigationFamily): NavigationNode[] {
  if (family.node.kind !== 'folder') return [family.node]
  return [
    ...(family.node.module
      ? [
          {
            kind: 'module' as const,
            key: family.node.module.source,
            name: family.name,
            spec: family.node.module,
          },
        ]
      : []),
    ...family.node.children,
  ]
}

function ArchitectureGraphIcon() {
  return (
    <svg class="nav-architecture-graph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="4" r="2" />
      <circle cx="4" cy="14" r="2" />
      <circle cx="16" cy="14" r="2" />
      <path d="m8.9 5.7-3.8 6.5M11.1 5.7l3.8 6.5M6 14h8" />
    </svg>
  )
}

function FullTreeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 4h12M4 8h8M4 12h12M4 16h6" />
    </svg>
  )
}

function ScopeMenuChevron() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m3.5 5.2 3.5 3.5 3.5-3.5" />
    </svg>
  )
}

function CurrentCheck() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="m3 7.2 2.4 2.4L11 4.5" />
    </svg>
  )
}

function ModuleSwitcherPanel({
  groups,
  query,
  queryTerms,
  total,
  directCount,
  relatedCount,
  showRelated,
  selected,
  pinnedSources,
  targetTab,
  requestedTab,
  sectionEntry,
  sectionTabs,
  sectionsLoading,
  activeOption,
  onSelect,
  onHighlight,
  onToggleRelated,
  onTogglePin,
  prefetch,
}: {
  groups: readonly ModuleSwitcherGroup[]
  query: string
  queryTerms: readonly string[]
  total: number
  directCount: number
  relatedCount: number
  showRelated: boolean
  selected: number
  pinnedSources: readonly string[]
  targetTab?: SpecTab
  requestedTab?: SpecTab
  sectionEntry?: NavigationSearchEntry
  sectionTabs?: readonly SpecTab[]
  sectionsLoading: boolean
  activeOption: { current: HTMLAnchorElement | null }
  onSelect(source: string): void
  onHighlight(index: number): void
  onToggleRelated(): void
  onTogglePin(source: string): void
  prefetch: PrefetchControls
}) {
  const searching = query.trim().length > 0
  const entries = groups.flatMap((group) => group.entries)
  const visibleSectionTabs =
    requestedTab && sectionTabs ? sectionTabs.filter((tab) => tab === requestedTab) : sectionTabs
  let offset = 0
  return (
    <section class="module-switcher-panel" aria-label="Module switcher">
      <header class="module-switcher-heading">
        <span>
          {searching
            ? directCount
              ? `${directCount} exact module${directCount === 1 ? '' : 's'}`
              : `${total} matching modules`
            : 'Quick access'}
        </span>
        {searching && directCount > 0 && relatedCount > 0 ? (
          <small>{total} total</small>
        ) : searching && total > entries.length ? (
          <small>Best {entries.length} shown</small>
        ) : null}
      </header>
      <div class="module-switcher-results">
        <div id="module-switcher-results" role="listbox">
          {groups.map((group) => {
            const start = offset
            offset += group.entries.length
            return (
              <section
                key={group.label}
                class="module-switcher-group"
                role="group"
                aria-label={group.label}
              >
                <header>{group.label}</header>
                {group.entries.map((entry, position) => {
                  const index = start + position
                  const highlighted = selected === index
                  const pinned = pinnedSources.includes(entry.spec.source)
                  return (
                    <div
                      key={entry.spec.source}
                      class="module-switcher-row"
                      data-highlighted={highlighted ? 'true' : 'false'}
                      onPointerMove={() => onHighlight(index)}
                    >
                      <a
                        ref={(node) => {
                          if (highlighted && node) activeOption.current = node
                        }}
                        id={`module-switcher-option-${index}`}
                        role="option"
                        aria-selected={highlighted}
                        href={routeHref(entry.spec.source, undefined, targetTab)}
                        data-spec-source={entry.spec.source}
                        onClick={() => onSelect(entry.spec.source)}
                        onPointerEnter={() => prefetch.schedule(entry.spec)}
                        onPointerLeave={prefetch.cancel}
                        onFocus={() => {
                          onHighlight(index)
                          prefetch.now(entry.spec)
                        }}
                      >
                        <span
                          class="module-switcher-icon"
                          data-root={entry.ownerPath ? undefined : 'true'}
                          aria-hidden="true"
                        >
                          <ModuleIcon icon={entry.spec.icon} />
                        </span>
                        <span class="module-switcher-copy">
                          <strong translate={false}>
                            <HighlightedModuleTitle title={entry.spec.title} terms={queryTerms} />
                          </strong>
                          <small translate={false}>{entry.ownerPath ?? 'Top-level module'}</small>
                        </span>
                        <span class="module-switcher-meta">
                          {targetTab && (
                            <span class="module-switcher-target">
                              {navigationTabLabel(targetTab)}
                            </span>
                          )}
                          {(entry.spec.metrics.status === 'error' ||
                            entry.spec.metrics.status === 'fail') && (
                            <span
                              class={`module-switcher-status status-label-${entry.spec.metrics.status}`}
                            >
                              {statusLabel(entry.spec.metrics.status)}
                            </span>
                          )}
                        </span>
                      </a>
                      <button
                        type="button"
                        class="module-switcher-pin"
                        data-pinned={pinned ? 'true' : 'false'}
                        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${entry.spec.title}`}
                        title={`${pinned ? 'Unpin' : 'Pin'} ${entry.spec.title}`}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => onTogglePin(entry.spec.source)}
                      >
                        <PinIcon filled={pinned} />
                      </button>
                    </div>
                  )
                })}
              </section>
            )
          })}
          {entries.length === 0 && (
            <div class="module-switcher-empty">
              <SearchEmptyIcon />
              <strong>{searching ? 'No modules found' : 'Your modules, one shortcut away'}</strong>
              <p>
                {searching
                  ? 'Try a shorter name, another family, section, or status.'
                  : 'Start typing, or pin modules you return to often.'}
              </p>
              {!searching && (
                <span>
                  Try <code>runtime schema history</code> or <code>tab:history</code>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {sectionEntry && (sectionsLoading || sectionTabs !== undefined) && (
        <div
          class="module-switcher-sections"
          role="navigation"
          aria-label={`Open ${sectionEntry.spec.title} section`}
        >
          <span>Open section</span>
          {sectionsLoading ? (
            <small>Loading…</small>
          ) : visibleSectionTabs?.length ? (
            <div class="module-switcher-section-links">
              {visibleSectionTabs.map((tab) => (
                <a
                  key={tab}
                  href={routeHref(sectionEntry.spec.source, undefined, tab)}
                  data-target={targetTab === tab ? 'true' : undefined}
                  onClick={() => onSelect(sectionEntry.spec.source)}
                >
                  {navigationTabLabel(tab)}
                </a>
              ))}
            </div>
          ) : (
            <small>
              {requestedTab ? `${navigationTabLabel(requestedTab)} is unavailable` : 'No sections'}
            </small>
          )}
        </div>
      )}
      {directCount > 0 && relatedCount > 0 && (
        <button
          type="button"
          class="module-switcher-related-toggle"
          aria-expanded={showRelated}
          onClick={onToggleRelated}
        >
          {showRelated ? 'Hide' : 'Show'} {relatedCount} related module
          {relatedCount === 1 ? '' : 's'}
        </button>
      )}
      <footer class="module-switcher-help" aria-hidden="true">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Select
        </span>
        <span>
          <kbd>↵</kbd> Open
        </span>
        <span>
          <kbd>⌘</kbd>
          <kbd>↵</kbd> New tab
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
      </footer>
    </section>
  )
}

function HighlightedModuleTitle({ title, terms }: { title: string; terms: readonly string[] }) {
  const needles = [
    ...new Set(
      terms
        .flatMap((term) => term.split(' '))
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => right.length - left.length)
  if (needles.length === 0) return title
  const highlighted = new Set(needles.map((term) => term.toLocaleLowerCase()))
  const pattern = new RegExp(`(${needles.map(escapeRegExp).join('|')})`, 'giu')
  return (
    <>
      {title
        .split(pattern)
        .map((part, index) =>
          highlighted.has(part.toLocaleLowerCase()) ? (
            <mark key={`${part}:${index}`}>{part}</mark>
          ) : (
            part
          ),
        )}
    </>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function navigationTabLabel(tab: SpecTab): string {
  return tab === 'api' ? 'API' : `${tab[0]?.toUpperCase()}${tab.slice(1)}`
}

function switcherGroups(
  index: readonly NavigationSearchEntry[],
  ranked: readonly NavigationSearchResult[],
  query: string,
  pinnedSources: readonly string[],
  recentSources: readonly string[],
  showRelated: boolean,
): ModuleSwitcherGroup[] {
  if (query.trim()) {
    const direct = ranked.filter((result) => result.direct)
    if (direct.length > 0) {
      const related = ranked.filter((result) => !result.direct)
      return [
        { label: 'Exact modules', entries: direct.map(({ entry }) => entry) },
        ...(showRelated && related.length
          ? [{ label: 'Related modules', entries: related.map(({ entry }) => entry) }]
          : []),
      ]
    }
    return [
      {
        label: 'Best matches',
        entries: ranked.slice(0, SWITCHER_FALLBACK_LIMIT).map(({ entry }) => entry),
      },
    ]
  }
  const bySource = new Map(index.map((entry) => [entry.spec.source, entry]))
  const pinned = pinnedSources.flatMap((source) => {
    const entry = bySource.get(source)
    return entry ? [entry] : []
  })
  const pinnedSet = new Set(pinnedSources)
  const recent = recentSources.flatMap((source) => {
    const entry = bySource.get(source)
    return entry && !pinnedSet.has(source) ? [entry] : []
  })
  return [
    ...(pinned.length ? [{ label: 'Pinned', entries: pinned }] : []),
    ...(recent.length ? [{ label: 'Recent', entries: recent.slice(0, 8) }] : []),
  ]
}

function statusLabel(status: CatalogSpecMetrics['status']): string {
  return status === 'ok'
    ? 'Ready'
    : status === 'pass'
      ? 'Passing'
      : status === 'error'
        ? 'Error'
        : status === 'fail'
          ? 'Failing'
          : status === 'pending'
            ? 'Pending'
            : 'Idle'
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.2 2.5h5.6l-.7 3 1.8 2v1H8.7v4.8L8 14l-.7-.7V8.5H4.1v-1l1.8-2z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

function SearchEmptyIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" />
      <path d="m17 17 5 5M12 8.5v7M8.5 12H15.5" />
    </svg>
  )
}

function NavigationNodes({
  nodes,
  active,
  depth,
  expansionMode,
  expanded,
  setExpanded,
}: NavigationNodesProps) {
  if (nodes.length === 0) return null
  return (
    <ul class={depth === 0 ? 'nav-tree' : 'nav-tree nav-tree-children'}>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <Folder
            key={node.key}
            node={node}
            active={active}
            depth={depth}
            expansionMode={expansionMode}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        ) : node.kind === 'module' ? (
          <ModuleLink key={node.key} node={node} active={active} />
        ) : (
          <SpecLink key={node.key} node={node} active={active} />
        ),
      )}
    </ul>
  )
}

function ModuleLink({ node, active }: { node: NavigationModuleNode; active?: string }) {
  const metrics = metricsOf(node.spec)
  return (
    <li class="nav-tree-item nav-module-item">
      <a
        class="nav-module"
        href={routeHref(node.spec.source)}
        aria-current={active === node.spec.source ? 'page' : undefined}
        aria-label={`${node.name} module`}
        title={`${node.name}\n${node.spec.title}\n${node.spec.source}`}
        data-spec-source={node.spec.source}
      >
        <span class="nav-module-status" aria-hidden="true">
          <span class={`status-dot status-${metrics.status}`} />
        </span>
        <ModuleIcon icon={node.spec.icon} />
        <span class="nav-module-name">{node.name}</span>
        {(metrics.open > 0 || metrics.errors > 0) && (
          <span class="nav-counts">
            {metrics.open > 0 && (
              <span class="open-count" aria-label={`${metrics.open} open items`}>
                {metrics.open}
              </span>
            )}
            {metrics.errors > 0 && (
              <span class="logic-count" aria-label={`${metrics.errors} errors`}>
                {metrics.errors}
              </span>
            )}
          </span>
        )}
      </a>
    </li>
  )
}

function Folder({
  node,
  active,
  depth,
  expansionMode,
  expanded,
  setExpanded,
}: Omit<NavigationNodesProps, 'nodes'> & { node: NavigationFolderNode }) {
  const containsActive = node.specs.some((spec) => spec.source === active)
  const defaultExpanded =
    expansionMode === 'family' ||
    (expansionMode === 'all' && depth < 2) ||
    (containsActive && node.module?.source !== active)
  const open = expanded[node.key] ?? defaultExpanded
  const metrics = summarize(node.specs)
  const meta = (
    <span class="nav-folder-meta">
      {!open && metrics.open > 0 && (
        <span class="nav-folder-open" aria-label={`${metrics.open} open items`}>
          {metrics.open}
        </span>
      )}
      {!open && metrics.errors > 0 && (
        <span class="nav-folder-error" aria-label={`${metrics.errors} errors`}>
          {metrics.errors}
        </span>
      )}
      <span class="nav-folder-count" aria-label={`${node.specs.length} specifications`}>
        {node.specs.length}
      </span>
    </span>
  )

  return (
    <li class="nav-tree-item nav-folder-item">
      {node.module ? (
        <div
          class="nav-folder nav-module-folder"
          data-expanded={open ? 'true' : 'false'}
          data-current={active === node.module.source ? 'page' : undefined}
        >
          <button
            type="button"
            class="nav-folder-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name} submodules`}
            onClick={() => setExpanded(node.key, !open)}
          >
            <Chevron />
          </button>
          <a
            class="nav-folder-module-target"
            href={routeHref(node.module.source)}
            aria-current={active === node.module.source ? 'page' : undefined}
            aria-label={`${node.name} module`}
            title={`${node.key}\n${node.module.title}`}
            data-spec-source={node.module.source}
          >
            <ModuleIcon icon={node.module.icon} />
            <span class="nav-folder-name">{node.name}</span>
            {meta}
          </a>
        </div>
      ) : (
        <button
          type="button"
          class="nav-folder"
          data-expanded={open ? 'true' : 'false'}
          aria-expanded={open}
          aria-label={`${node.name} folder`}
          title={node.key}
          onClick={() => setExpanded(node.key, !open)}
        >
          <Chevron />
          <FolderIcon open={open} />
          <span class="nav-folder-name">{node.name}</span>
          {meta}
        </button>
      )}
      {open && (
        <NavigationNodes
          nodes={node.children}
          active={active}
          depth={depth + 1}
          expansionMode={expansionMode}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      )}
    </li>
  )
}

function SpecLink({
  node,
  active,
}: {
  node: Extract<NavigationNode, { kind: 'spec' }>
  active?: string
}) {
  const metrics = metricsOf(node.spec)
  return (
    <li class="nav-tree-item nav-spec-item">
      <a
        class="nav-spec"
        href={routeHref(node.spec.source)}
        aria-current={active === node.spec.source ? 'page' : undefined}
        title={`${node.spec.title}\n${node.spec.source}`}
        data-spec-source={node.spec.source}
      >
        <span class={`status-dot status-${metrics.status}`} aria-hidden="true" />
        <span class="nav-spec-name">{node.spec.title}</span>
        {node.duplicateName && <span class="nav-spec-key">{node.duplicateName}</span>}
        {(metrics.open > 0 || metrics.errors > 0) && (
          <span class="nav-counts">
            {metrics.open > 0 && (
              <span class="open-count" aria-label={`${metrics.open} open items`}>
                {metrics.open}
              </span>
            )}
            {metrics.errors > 0 && (
              <span class="logic-count" aria-label={`${metrics.errors} errors`}>
                {metrics.errors}
              </span>
            )}
          </span>
        )}
      </a>
    </li>
  )
}

function specForTarget(
  target: EventTarget | null,
  specs: readonly CatalogSpecEntry[],
): CatalogSpecEntry | undefined {
  const source = specSource(target)
  return source ? specs.find((spec) => spec.source === source) : undefined
}

function specSource(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return
  return target.closest<HTMLElement>('[data-spec-source]')?.dataset.specSource
}

function useSpecPrefetch(
  active: string | undefined,
  load: NavigationProps['onSpecPrefetch'],
): PrefetchControls {
  const timer = useRef<number>()
  const cancel = () => {
    if (timer.current === undefined) return
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    },
    [],
  )
  return {
    cancel,
    now(spec) {
      cancel()
      if (spec.source !== active) load?.(spec)
    },
    schedule(spec) {
      cancel()
      if (spec.source === active) return
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        load?.(spec)
      }, PREFETCH_INTENT_DELAY_MS)
    },
  }
}

function metricsOf(spec: CatalogSpecEntry): CatalogSpecMetrics {
  return spec.metrics
}

function summarize(specs: CatalogSpecEntry[]): Pick<CatalogSpecMetrics, 'errors' | 'open'> {
  return specs.reduce(
    (result, spec) => {
      const metrics = metricsOf(spec)
      result.errors += metrics.errors
      result.open += metrics.open
      return result
    },
    { errors: 0, open: 0 },
  )
}

function Chevron() {
  return (
    <svg class="nav-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  )
}

function HistoryArrow({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={direction === 'back' ? 'm9.8 3.5-4.5 4.5 4.5 4.5' : 'm6.2 3.5 4.5 4.5-4.5 4.5'} />
    </svg>
  )
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg class="nav-folder-icon" viewBox="0 0 18 18" aria-hidden="true">
      {open ? (
        <path d="M2.5 5.5h5l1.3 1.7h6.7l-1.3 6.3H3.4zM2.5 5.5V4h4.4l1.3 1.5h6.3v1.7" />
      ) : (
        <path d="M2.5 4h4.4l1.5 1.7h7.1v7.8h-13z" />
      )}
    </svg>
  )
}

function trapCommandPaletteFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !(event.currentTarget instanceof HTMLElement)) return
  const palette = event.currentTarget
  const focusable = [
    ...palette.querySelectorAll<HTMLElement>('input, a[href], button:not(:disabled)'),
  ].filter((element) => element.getClientRects().length > 0)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function readStoredSources(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((source): source is string => typeof source === 'string').slice(0, 16)
      : []
  } catch {
    return []
  }
}

function writeStoredSources(key: string, sources: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(sources))
  } catch {
    // Navigation remains functional when browser storage is unavailable.
  }
}

function sameSources(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((source, index) => source === right[index])
}

function readNavigationMode(): 'scoped' | 'all' {
  try {
    return localStorage.getItem(NAVIGATION_MODE_KEY) === 'all' ? 'all' : 'scoped'
  } catch {
    return 'scoped'
  }
}

function writeNavigationMode(mode: 'scoped' | 'all'): void {
  try {
    localStorage.setItem(NAVIGATION_MODE_KEY, mode)
  } catch {
    // Scoped browsing remains functional when browser storage is unavailable.
  }
}

function readFamilyLocations(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(FAMILY_LOCATIONS_KEY) ?? '{}') as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1]),
      ),
    )
  } catch {
    return {}
  }
}

function writeFamilyLocations(locations: Readonly<Record<string, string>>): void {
  try {
    localStorage.setItem(FAMILY_LOCATIONS_KEY, JSON.stringify(locations))
  } catch {
    // Family switching falls back to each root module when storage is unavailable.
  }
}

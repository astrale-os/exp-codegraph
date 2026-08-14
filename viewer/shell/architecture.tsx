import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { CatalogSpecEntry } from '../../viewer-host/catalog.ts'
import type { SvgIconElement } from '../../specification/resource/index.ts'
import { MarkdownContent } from '../markdown/content.tsx'

import {
  architectureIconPack,
  dependencyMermaid,
  systemFlowMermaid,
  type ArchitectureDepth,
  type ArchitectureView,
} from './architecture-diagram.ts'
import { buildNavigationTree } from './navigation-model.ts'
import {
  architectureRelationships,
  buildArchitectureLayers,
  buildNavigationFamilies,
  navigationFamilyModules,
} from './navigation-scope.ts'
import { ModuleIcon } from './module-icon.tsx'
import { routeHref } from './route.ts'

export function ArchitectureOverview({ specs }: { specs: readonly CatalogSpecEntry[] }) {
  const [view, setView] = useState<ArchitectureView>('flow')
  const [depth, setDepth] = useState<ArchitectureDepth>('layers')
  const [familyFilter, setFamilyFilter] = useState<string>()
  const [expandedFamilies, setExpandedFamilies] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const topologyRef = useRef<HTMLElement>(null)
  const families = useMemo(
    () => buildNavigationFamilies(buildNavigationTree(specs)),
    [specs],
  )
  const layers = useMemo(() => buildArchitectureLayers(families), [families])
  const relationships = useMemo(() => architectureRelationships(families), [families])
  const visibleLayers = familyFilter
    ? layers.flatMap((layer) => {
        const members = layer.families.filter((family) => family.name === familyFilter)
        return members.length ? [{ ...layer, families: members }] : []
      })
    : layers
  const iconPacks = useMemo(() => [architectureIconPack(families)], [families])
  const host = families.find((family) => family.name === 'host')
  const diagram = useMemo(
    () => view === 'flow'
      ? systemFlowMermaid(families)
      : dependencyMermaid(layers, relationships, depth, familyFilter),
    [depth, families, familyFilter, layers, relationships, view],
  )

  useEffect(() => {
    const topology = topologyRef.current
    const icon = host?.identitySpec.icon
    if (!topology || view !== 'flow' || !icon) return
    const decorate = () => decorateHostBoundary(topology, icon)
    const observer = new MutationObserver(decorate)
    observer.observe(topology, { childList: true, subtree: true })
    decorate()
    return () => observer.disconnect()
  }, [diagram, host?.identitySpec.icon, view])

  return (
    <article class="architecture-map">
      <div class="architecture-map-controls">
        <div class="architecture-view-switch" aria-label="Architecture view">
          <button type="button" aria-pressed={view === 'flow'} onClick={() => setView('flow')}>
            <FlowViewIcon /> Flow
          </button>
          <button
            type="button"
            aria-pressed={view === 'dependencies'}
            onClick={() => setView('dependencies')}
          >
            <DependencyViewIcon /> Dependencies
          </button>
        </div>
        <div class="architecture-depth" aria-label="Map complexity">
          {(['layers', 'modules'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={depth === value}
              onClick={() => setDepth(value)}
            >
              {value === 'layers' ? 'Layers' : 'Modules'}
            </button>
          ))}
        </div>
        {view === 'dependencies' && <div
          class="architecture-family-filter"
          aria-label="Filter architecture family"
        >
          <button
            type="button"
            class="architecture-family-all"
            aria-label="Show every architecture family"
            aria-pressed={!familyFilter}
            title="All families"
            onClick={() => setFamilyFilter(undefined)}
          >
            <AllFamiliesIcon />
          </button>
          {families.map((family) => (
            <button
              key={family.key}
              type="button"
              aria-label={`Show ${family.name} architecture`}
              aria-pressed={familyFilter === family.name}
              title={family.name}
              onClick={() =>
                setFamilyFilter((current) => current === family.name ? undefined : family.name)
              }
            >
              <ModuleIcon icon={family.identitySpec.icon} />
            </button>
          ))}
        </div>}
      </div>

      <section
        ref={topologyRef}
        class="architecture-topology"
        data-view={view}
        aria-label={`${view} architecture`}
      >
        <MarkdownContent
          key={diagram}
          value={`\`\`\`mermaid\n${diagram}\n\`\`\``}
          compact
          mermaidIconPacks={iconPacks}
        />
      </section>

      <section class="architecture-flow" aria-label="Architecture layers">
        {visibleLayers.map((layer, index) => (
          <div class="architecture-layer-stage" key={layer.key}>
            <header>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><h2>{layer.name}</h2><p>{layer.description}</p></div>
            </header>
            <div class="architecture-family-cards">
              {layer.families.map((family) => {
                const allModules = navigationFamilyModules(family, 'all')
                const expanded = expandedFamilies.has(family.name)
                const modules = expanded ? allModules : allModules.slice(0, 8)
                const remaining = allModules.length - Math.min(8, allModules.length)
                return (
                  <section class="architecture-family-card" key={family.key}>
                    <a
                      class="architecture-family-title"
                      href={architectureModuleHref(family.identitySpec.source)}
                      data-spec-source={family.identitySpec.source}
                    >
                      <span><ModuleIcon icon={family.identitySpec.icon} /></span>
                      <div>
                        <h3 translate={false}>{family.name}</h3>
                        <p>{family.specs.length} modules</p>
                      </div>
                      <OpenModuleIcon />
                    </a>
                    {depth !== 'layers' && (
                      <div class="architecture-module-list">
                        {modules.map((module) => (
                          <a
                            key={module.spec.source}
                            href={architectureModuleHref(module.spec.source)}
                            data-spec-source={module.spec.source}
                            title={module.context}
                          >
                            <ModuleIcon icon={module.spec.icon} />
                            <span translate={false}>{module.name}</span>
                            <span class={`status-dot status-${module.spec.metrics.status}`} />
                          </a>
                        ))}
                        {remaining > 0 && (
                          <button
                            type="button"
                            class="architecture-module-more"
                            aria-expanded={expanded}
                            aria-label={expanded
                              ? `Show fewer ${family.name} modules`
                              : `Show ${remaining} more ${family.name} modules`}
                            onClick={() => setExpandedFamilies((current) => {
                              const next = new Set(current)
                              if (expanded) next.delete(family.name)
                              else next.add(family.name)
                              return next
                            })}
                          >
                            {expanded ? 'Show less' : `+${remaining} more`}
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </div>
        ))}
      </section>
    </article>
  )
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

function decorateHostBoundary(root: HTMLElement, icon: SvgIconElement): void {
  const cluster = root.querySelector<SVGGElement>('g.cluster[id*="host_boundary"]')
  const boundary = cluster?.querySelector<SVGRectElement>(':scope > rect')
  if (!cluster || !boundary || cluster.querySelector('.architecture-host-boundary-badge')) return

  const x = Number(boundary.getAttribute('x'))
  const y = Number(boundary.getAttribute('y'))
  const width = Number(boundary.getAttribute('width'))
  if (![x, y, width].every(Number.isFinite)) return

  const badgeWidth = 78
  const badgeHeight = 34
  const badgeX = x + width / 2 - badgeWidth / 2
  const badgeY = y - badgeHeight / 2
  const badge = svgElement('g', {
    class: 'architecture-host-boundary-badge',
    'aria-label': 'Host boundary',
    role: 'img',
  })
  badge.append(svgElement('rect', {
    class: 'architecture-host-boundary-badge-background',
    x: String(badgeX),
    y: String(badgeY),
    width: String(badgeWidth),
    height: String(badgeHeight),
    rx: '10',
  }))
  badge.append(svgIcon(icon, badgeX + 5, badgeY + 5, 24))
  const label = svgElement('text', {
    x: String(badgeX + 35),
    y: String(badgeY + 22),
  })
  label.textContent = 'host'
  badge.append(label)
  cluster.append(badge)
}

function svgIcon(icon: SvgIconElement, x: number, y: number, size: number): SVGElement {
  const element = svgElement(icon.name, {
    ...icon.attributes,
    x: String(x),
    y: String(y),
    width: String(size),
    height: String(size),
  })
  for (const child of icon.children) element.append(svgIconElement(child))
  return element
}

function svgIconElement(icon: SvgIconElement): SVGElement {
  const element = svgElement(icon.name, icon.attributes)
  for (const child of icon.children) element.append(svgIconElement(child))
  return element
}

function svgElement(
  name: string,
  attributes: Readonly<Record<string, string>>,
): SVGElement {
  const element = document.createElementNS(SVG_NAMESPACE, name)
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, value)
  }
  return element
}

function FlowViewIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h11M10 4.5 13.5 8 10 11.5" /></svg>
}

function DependencyViewIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" /><circle cx="13" cy="4" r="1.5" />
      <circle cx="13" cy="12" r="1.5" /><path d="m4.5 7.4 7-2.8M4.5 8.6l7 2.8" />
    </svg>
  )
}

export function architectureModuleHref(source: string): string {
  return routeHref(source, undefined, 'api')
}

function AllFamiliesIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </svg>
  )
}

function OpenModuleIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 11 11 5M6 5h5v5" />
    </svg>
  )
}

import { useState } from 'preact/hooks'

import type { PortResource } from '../../specification/resource/index.ts'
import type {
  ApiDefinitionOwner,
  ApiDefinitionTarget,
  ApiNavigationState,
  ApiOutlineExport,
  ApiOutlineNode,
} from './api.tsx'

import { apiOutline, ApiView } from './api.tsx'

export function PortsView({
  ports,
  selectedSource,
  definitionOwners,
  moduleSource,
  onOpenDefinition,
  onSourceChange,
}: {
  ports: readonly PortResource[]
  selectedSource?: string
  definitionOwners?: ReadonlyMap<string, ApiDefinitionOwner>
  moduleSource?: string
  onOpenDefinition?(target: ApiDefinitionTarget): void
  onSourceChange?(source: string): void
}) {
  const [selectedKey, setSelectedKey] = useState(ports[0] ? portKey(ports[0]) : undefined)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [navigation, setNavigation] = useState<Readonly<Record<string, ApiNavigationState>>>({})
  const selected =
    ports.find((port) => port.source === selectedSource) ??
    ports.find((port) => portKey(port) === selectedKey) ??
    ports[0]
  if (!selected) return null
  const currentKey = portKey(selected)
  const selectedNavigation = navigation[currentKey] ?? principalNavigation(selected)
  return (
    <section class="api-ide ports-ide" aria-label="Ports">
      <aside class="api-outline ports-outline" aria-label="Ports outline">
        <header>
          <span>Ports</span>
          <small>{ports.length} Ports</small>
        </header>
        <nav>
          {groupPorts(ports).map((group) => (
            <section
              class="ports-outline-namespace-group"
              key={group.namespace ?? portKey(group.ports[0]!)}
            >
              {group.namespace && (
                <header class="ports-outline-namespace">
                  <code>{group.namespace}</code>
                  <small>{group.ports.length}</small>
                </header>
              )}
              {group.ports.map((port) => {
                const key = portKey(port)
                if (group.namespace) {
                  const item = principalExport(port)
                  if (!item) return null
                  return (
                    <div
                      class="api-outline-children ports-outline-namespace-children"
                      role="group"
                      key={key}
                    >
                      <button
                        type="button"
                        class="api-outline-export"
                        aria-pressed={
                          key === currentKey && selectedNavigation.declaration === item.identity
                        }
                        onClick={() => {
                          setSelectedKey(key)
                          onSourceChange?.(port.source)
                          setNavigation((current) => ({
                            ...current,
                            [key]: declarationNavigation(port, item.identity),
                          }))
                        }}
                        title={`${group.namespace}.${item.path} — ${port.ref}`}
                      >
                        <span class={`api-outline-kind api-outline-kind-${item.declarationKind}`}>
                          {kindGlyph(item.declarationKind)}
                        </span>
                        <code>{item.path}</code>
                      </button>
                    </div>
                  )
                }

                const principal = port.port
                const supporting = supportingExports(port)
                const open = expanded.has(key)
                return (
                  <section class="api-outline-group ports-outline-group" key={key}>
                    <button
                      type="button"
                      class="api-outline-group-toggle ports-outline-port"
                      aria-expanded={supporting.length ? open : undefined}
                      aria-pressed={
                        key === currentKey &&
                        selectedNavigation.declaration === principal.declaration
                      }
                      onClick={() => {
                        setSelectedKey(key)
                        onSourceChange?.(port.source)
                        setNavigation((current) => ({
                          ...current,
                          [key]: principalNavigation(port),
                        }))
                        if (supporting.length) {
                          setExpanded((current) => toggleExpanded(current, key))
                        }
                      }}
                      title={`${principal.name} — ${port.ref}`}
                    >
                      <span
                        class={`api-outline-chevron${supporting.length ? '' : ' ports-outline-leaf'}`}
                        aria-hidden="true"
                      >
                        {supporting.length ? '›' : '·'}
                      </span>
                      <span class="api-outline-kind api-outline-kind-interface">I</span>
                      <code>{principal.name}</code>
                      {supporting.length > 0 && <small>{supporting.length}</small>}
                    </button>
                    {open && supporting.length > 0 && (
                      <div class="api-outline-children" role="group">
                        {supporting.map((item) => (
                          <button
                            type="button"
                            class="api-outline-export"
                            aria-pressed={
                              key === currentKey && selectedNavigation.declaration === item.identity
                            }
                            onClick={() => {
                              setSelectedKey(key)
                              onSourceChange?.(port.source)
                              setNavigation((current) => ({
                                ...current,
                                [key]: declarationNavigation(port, item.identity),
                              }))
                            }}
                            title={item.path}
                            key={`${key}:${item.identity}`}
                          >
                            <span
                              class={`api-outline-kind api-outline-kind-${item.declarationKind}`}
                            >
                              {kindGlyph(item.declarationKind)}
                            </span>
                            <code>{item.path}</code>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </section>
          ))}
        </nav>
      </aside>
      <ApiView
        api={selected.model}
        source={selected.source}
        text={selected.text}
        navigation={selectedNavigation}
        contextualSourceTabs
        hideOutline
        definitionOwners={definitionOwners}
        moduleSource={moduleSource}
        onOpenDefinition={onOpenDefinition}
        onNavigationChange={(next) =>
          setNavigation((current) => ({ ...current, [currentKey]: next }))
        }
      />
    </section>
  )
}

export function supportingExports(port: PortResource): ApiOutlineExport[] {
  return portExports(port).filter((item) => item.identity !== port.port.declaration)
}

/** Resolve the one locally discovered injectable interface for this Port resource. */
export function principalExport(port: PortResource): ApiOutlineExport | undefined {
  return portExports(port).find((item) => item.identity === port.port.declaration)
}

export interface PortGroup {
  readonly namespace?: string
  readonly ports: readonly PortResource[]
}

/** Group namespaced resources together while preserving authored manifest order. */
export function groupPorts(ports: readonly PortResource[]): PortGroup[] {
  const groups: PortGroup[] = []
  const named = new Map<string, number>()
  for (const port of ports) {
    if (!port.namespace) {
      groups.push({ ports: [port] })
      continue
    }
    const existing = named.get(port.namespace)
    if (existing === undefined) {
      named.set(port.namespace, groups.length)
      groups.push({ namespace: port.namespace, ports: [port] })
      continue
    }
    const current = groups[existing]!
    groups[existing] = { ...current, ports: [...current.ports, port] }
  }
  return groups
}

function portExports(port: PortResource): ApiOutlineExport[] {
  const exports: ApiOutlineExport[] = []
  collectExports(apiOutline(port.model), exports)
  return exports
}

function collectExports(nodes: readonly ApiOutlineNode[], target: ApiOutlineExport[]): void {
  for (const node of nodes) {
    if (node.type === 'export') target.push(node)
    else collectExports(node.children, target)
  }
}

function principalNavigation(port: PortResource): ApiNavigationState {
  return {
    source: port.model?.entrypoint ?? port.source,
    declaration: port.port.declaration,
    expanded: [],
  }
}

function portKey(port: PortResource): string {
  return `${port.namespace ?? ''}\0${port.ref}`
}

function declarationNavigation(port: PortResource, declaration: string): ApiNavigationState {
  const source = port.model?.tokens.find((token) => token.declaration === declaration)?.file
  return { source: source ?? port.source, declaration, expanded: [] }
}

function toggleExpanded(current: ReadonlySet<string>, ref: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(ref)) next.delete(ref)
  else next.add(ref)
  return next
}

function kindGlyph(kind: string): string {
  if (kind === 'class') return 'C'
  if (kind === 'interface') return 'I'
  if (kind === 'callable') return 'ƒ'
  return 'T'
}

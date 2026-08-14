import { useEffect, useMemo, useState } from 'preact/hooks'

import type { ApiModel, ApiSource } from '../../api/model.ts'

import { routeHref } from '../shell/route.ts'
import { DeclarationEditor } from './declaration-editor.tsx'

export interface ApiDefinitionOwner {
  readonly source: string
  readonly title: string
}

export interface ApiDefinitionTarget {
  readonly owner: ApiDefinitionOwner
  readonly navigation: ApiNavigationState
}

interface ApiViewProps {
  api?: ApiModel
  source?: string
  text?: string
  navigation?: ApiNavigationState
  onNavigationChange?(
    navigation: ApiNavigationState,
    history: ApiNavigationHistory,
    previous: ApiNavigationState,
  ): void
  /** Hide the entrypoint file tab until symbol navigation opens an imported declaration. */
  contextualSourceTabs?: boolean
  /** Embed only the declaration editor when another view owns the outline. */
  hideOutline?: boolean
  /** Catalog-level ownership used to leave an imported declaration for its defining module. */
  definitionOwners?: ReadonlyMap<string, ApiDefinitionOwner>
  moduleSource?: string
  onOpenDefinition?(target: ApiDefinitionTarget): void
}

export type ApiNavigationHistory = 'push' | 'replace'

export interface ApiNavigationState {
  readonly source: string
  readonly declaration?: string
  readonly expanded: readonly string[]
}

export function ApiView({
  api,
  source,
  text,
  navigation: rememberedNavigation,
  onNavigationChange,
  contextualSourceTabs = false,
  hideOutline = false,
  definitionOwners,
  moduleSource,
  onOpenDefinition,
}: ApiViewProps) {
  const sources = api?.sources ?? fallbackSources(source, text)
  const outline = useMemo(() => apiOutline(api), [api])
  const sourceLabels = useMemo(() => uniqueSourceLabels(sources), [sources])
  const identityDeclarations = useMemo(
    () =>
      api
        ? api.surface.declarations.filter(
            (declaration) => api.metadata[declaration.identity]?.conformance === 'identity',
          ).length
        : 0,
    [api],
  )
  const [navigation, setNavigation] = useState<ApiNavigationState>(() =>
    restoreApiNavigation(rememberedNavigation, api, sources, outline),
  )
  const restoredNavigation = restoreApiNavigation(rememberedNavigation, api, sources, outline)
  const restoredNavigationKey = navigationKey(restoredNavigation)
  useEffect(() => {
    setNavigation((current) =>
      navigationKey(current) === restoredNavigationKey ? current : restoredNavigation,
    )
  }, [restoredNavigationKey])
  const expanded = useMemo(() => new Set(navigation.expanded), [navigation.expanded])
  const current = sources.find((candidate) => candidate.file === navigation.source) ?? sources[0]
  const selectedToken = navigation.declaration
    ? api?.tokens.find((candidate) => candidate.declaration === navigation.declaration)
    : undefined
  const focusOffset = selectedToken?.file === current?.file ? selectedToken.from : undefined
  const sourceTabs = current
    ? visibleApiSourceTabs(api, sources, current, contextualSourceTabs)
    : []
  const definitionTarget = apiDefinitionTarget(api, navigation, moduleSource, definitionOwners)

  const updateNavigation = (
    update: (current: ApiNavigationState) => ApiNavigationState,
    history: ApiNavigationHistory,
  ) => {
    setNavigation((current) => {
      const next = update(current)
      onNavigationChange?.(next, history, current)
      return next
    })
  }

  const navigate = (identity: string) => {
    const token = api?.tokens.find((candidate) => candidate.declaration === identity)
    if (!token) return
    updateNavigation(
      (current) => ({
        source: token.file,
        declaration: identity,
        expanded: mergeExpanded(current.expanded, api ? namespacePaths(api, identity) : []),
      }),
      'push',
    )
  }
  const openDefinition = (identity: string) => {
    const target = apiOwnedDefinitionTarget(api, identity, moduleSource, definitionOwners)
    if (!target || !onOpenDefinition) {
      navigate(identity)
      return
    }
    onOpenDefinition(target)
  }
  const toggle = (path: string) => {
    updateNavigation((current) => {
      const next = new Set(current.expanded)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { ...current, expanded: [...next].sort() }
    }, 'replace')
  }

  if (!current) return null
  return (
    <section
      class={`api-ide${hideOutline ? ' api-ide-editor-only' : ''}`}
      aria-label="TypeScript declaration API"
    >
      {!hideOutline && (
        <aside class="api-outline" aria-label="API outline">
          <header>
            <span>API</span>
            <small>
              <span>{api?.surface.exports.length ?? 0} exports</span>
              {identityDeclarations > 0 && <span>{identityDeclarations} identity</span>}
            </small>
          </header>
          <nav>
            {outline.map((node) =>
              node.type === 'group' ? (
                <OutlineGroup
                  group={node}
                  expanded={expanded}
                  toggle={toggle}
                  navigate={navigate}
                  selected={navigation.declaration}
                  key={node.path}
                />
              ) : (
                <OutlineExport
                  item={node}
                  navigate={navigate}
                  selected={navigation.declaration}
                  key={`${node.path}:${node.identity}`}
                />
              ),
            )}
          </nav>
        </aside>
      )}
      <div class={`api-editor-pane${sourceTabs.length ? '' : ' api-editor-pane-tabless'}`}>
        {sourceTabs.length > 0 && (
          <nav class="api-source-tabs" aria-label="Declaration sources">
            {sourceTabs.map(({ source: candidate, role }) => (
              <button
                type="button"
                class={`${candidate.file === current.file ? 'selected' : ''}${
                  role === 'imported' ? ' api-source-tab-imported' : ''
                }`}
                title={
                  role === 'entrypoint'
                    ? 'Specification declaration entrypoint'
                    : 'Imported declaration opened through symbol navigation'
                }
                onClick={() => {
                  updateNavigation(
                    (current) => ({
                      source: candidate.file,
                      expanded: current.expanded,
                    }),
                    'push',
                  )
                }}
                key={candidate.file}
              >
                <span class="api-ts-icon">TS</span>
                {sourceLabels[sources.indexOf(candidate)]}
                <span class={`api-source-role api-source-role-${role}`}>
                  {role === 'entrypoint' ? 'API' : 'imported'}
                </span>
              </button>
            ))}
            {definitionTarget && (
              <a
                class="api-definition-jump"
                href={routeHref(
                  definitionTarget.owner.source,
                  undefined,
                  'api',
                  definitionTarget.navigation,
                )}
                title={`Open this definition in ${definitionTarget.owner.title}`}
                aria-label={`Open this definition in ${definitionTarget.owner.title}`}
              >
                <DefinitionJumpIcon />
                <span>Open module</span>
              </a>
            )}
          </nav>
        )}
        <DeclarationEditor
          api={api}
          source={current}
          focusOffset={focusOffset}
          onNavigate={(identity, intent) =>
            intent === 'open-definition' ? openDefinition(identity) : navigate(identity)
          }
        />
        <footer class="api-statusbar">
          <span>TypeScript declaration</span>
          {api && <span title={api.fingerprint}>API {api.fingerprint.slice(0, 10)}</span>}
          <span>{current.file}</span>
        </footer>
      </div>
    </section>
  )
}

export function apiDefinitionTarget(
  api: ApiModel | undefined,
  navigation: ApiNavigationState,
  moduleSource: string | undefined,
  owners: ReadonlyMap<string, ApiDefinitionOwner> | undefined,
): ApiDefinitionTarget | undefined {
  if (!api || !navigation.declaration || !owners) return
  const token = api.tokens.find(
    (candidate) =>
      candidate.declaration === navigation.declaration && candidate.file === navigation.source,
  )
  if (!token || token.file === api.entrypoint) return
  return apiOwnedDefinitionTarget(api, navigation.declaration, moduleSource, owners)
}

export function apiOwnedDefinitionTarget(
  api: ApiModel | undefined,
  identity: string,
  moduleSource: string | undefined,
  owners: ReadonlyMap<string, ApiDefinitionOwner> | undefined,
): ApiDefinitionTarget | undefined {
  if (!api || !owners) return
  const token = api.tokens.find((candidate) => candidate.declaration === identity)
  if (!token) return
  const owner = owners.get(identity)
  if (!owner || owner.source === moduleSource) return
  return {
    owner,
    navigation: {
      source: token.file,
      declaration: identity,
      expanded: [],
    },
  }
}

export interface VisibleApiSourceTab {
  readonly source: ApiSource
  readonly role: 'entrypoint' | 'imported'
}

export function visibleApiSourceTabs(
  api: ApiModel | undefined,
  sources: readonly ApiSource[],
  current: ApiSource,
  contextual = false,
): VisibleApiSourceTab[] {
  const entrypoint = sources.find((source) => source.file === api?.entrypoint) ?? sources[0]
  if (!entrypoint) return []
  if (contextual && current.file === entrypoint.file) return []
  const tabs: VisibleApiSourceTab[] = [{ source: entrypoint, role: 'entrypoint' }]
  if (current.file !== entrypoint.file) tabs.push({ source: current, role: 'imported' })
  return tabs
}

export function restoreApiNavigation(
  remembered: ApiNavigationState | undefined,
  api: ApiModel | undefined,
  sources: readonly ApiSource[],
  outline = apiOutline(api),
): ApiNavigationState {
  const sourceFiles = new Set(sources.map((candidate) => candidate.file))
  const entrypoint = sources.find((candidate) => candidate.file === api?.entrypoint) ?? sources[0]
  const declarationToken = remembered?.declaration
    ? api?.tokens.find((candidate) => candidate.declaration === remembered.declaration)
    : undefined
  const source =
    declarationToken?.file ??
    (remembered && sourceFiles.has(remembered.source) ? remembered.source : entrypoint?.file) ??
    ''
  const validPaths = outlineGroupPaths(outline)
  const expanded = [...new Set(remembered?.expanded ?? [])]
    .filter((path) => validPaths.has(path))
    .sort()
  return {
    source,
    ...(declarationToken ? { declaration: declarationToken.declaration } : {}),
    expanded,
  }
}

export function apiOutline(api?: ApiModel) {
  if (!api) return []
  const declarations = new Map(api.surface.declarations.map((item) => [item.identity, item]))
  const root = mutableGroup('Root', '$root')
  for (const [order, item] of api.surface.exports.entries()) {
    const segments = [...item.path]
    const name = segments.pop() ?? item.name
    let group = root
    let path = ''
    for (const segment of segments) {
      path = path ? `${path}.${segment}` : segment
      let child = group.groups.get(segment)
      if (!child) {
        child = mutableGroup(segment, path, order)
        group.groups.set(segment, child)
      }
      child.order = Math.min(child.order, order)
      group = child
    }
    const declaration = declarations.get(item.declaration)
    group.exports.push({
      type: 'export',
      identity: item.declaration,
      name,
      path: item.path.join('.'),
      declarationKind: declaration?.kind ?? item.kind,
      ...(api.metadata[item.declaration]?.conformance === 'identity'
        ? { conformance: 'identity' as const }
        : {}),
      order,
    })
  }

  return finalizeChildren(root)
}

export interface ApiOutlineGroup {
  readonly type: 'group'
  readonly name: string
  readonly path: string
  readonly count: number
  readonly children: readonly ApiOutlineNode[]
}

export interface ApiOutlineExport {
  readonly type: 'export'
  readonly identity: string
  readonly name: string
  readonly path: string
  readonly declarationKind: string
  readonly conformance?: 'identity'
}

export type ApiOutlineNode = ApiOutlineGroup | ApiOutlineExport

interface MutableOutlineGroup {
  readonly name: string
  readonly path: string
  order: number
  readonly groups: Map<string, MutableOutlineGroup>
  readonly exports: OrderedOutlineExport[]
}

type OrderedOutlineExport = ApiOutlineExport & { readonly order: number }

function OutlineGroup({
  group,
  expanded,
  toggle,
  navigate,
  selected,
}: {
  group: ApiOutlineGroup
  expanded: ReadonlySet<string>
  toggle(path: string): void
  navigate(identity: string): void
  selected?: string
}) {
  const open = expanded.has(group.path)
  return (
    <section class="api-outline-group">
      <button
        type="button"
        class="api-outline-group-toggle"
        aria-expanded={open}
        onClick={() => toggle(group.path)}
        title={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
      >
        <span class="api-outline-chevron" aria-hidden="true">
          ›
        </span>
        <span class="api-outline-namespace" aria-hidden="true">
          N
        </span>
        <code>{group.name}</code>
        <small>{group.count}</small>
      </button>
      {open && (
        <div class="api-outline-children" role="group">
          {group.children.map((child) =>
            child.type === 'group' ? (
              <OutlineGroup
                group={child}
                expanded={expanded}
                toggle={toggle}
                navigate={navigate}
                selected={selected}
                key={child.path}
              />
            ) : (
              <OutlineExport
                item={child}
                navigate={navigate}
                selected={selected}
                key={`${child.path}:${child.identity}`}
              />
            ),
          )}
        </div>
      )}
    </section>
  )
}

function OutlineExport({
  item,
  navigate,
  selected,
}: {
  item: ApiOutlineExport
  navigate(identity: string): void
  selected?: string
}) {
  return (
    <button
      type="button"
      class="api-outline-export"
      aria-pressed={item.identity === selected}
      onClick={() => navigate(item.identity)}
      title={item.path}
    >
      <span class={`api-outline-kind api-outline-kind-${item.declarationKind}`}>
        {kindGlyph(item.declarationKind)}
      </span>
      <code>{item.name}</code>
      {item.conformance === 'identity' && (
        <span
          class="api-outline-conformance"
          title="Identity-only contract: name, kind, export path, reference, and boundary are checked; declaration shape is intentionally unconstrained."
        >
          identity
        </span>
      )}
    </button>
  )
}

function mutableGroup(
  name: string,
  path: string,
  order = Number.POSITIVE_INFINITY,
): MutableOutlineGroup {
  return { name, path, order, groups: new Map(), exports: [] }
}

function finalizeGroup(group: MutableOutlineGroup): ApiOutlineGroup {
  const children = finalizeChildren(group)
  return {
    type: 'group',
    name: group.name,
    path: group.path,
    count: children.reduce((count, child) => count + (child.type === 'group' ? child.count : 1), 0),
    children,
  }
}

function finalizeChildren(group: MutableOutlineGroup): ApiOutlineNode[] {
  return [
    ...[...group.groups.values()].map((child) => ({
      order: child.order,
      node: finalizeGroup(child) as ApiOutlineNode,
    })),
    ...group.exports.map(({ order, ...item }) => ({ order, node: item as ApiOutlineNode })),
  ]
    .sort((left, right) => left.order - right.order)
    .map(({ node }) => node)
}

function fallbackSources(source?: string, text?: string): ApiSource[] {
  if (text === undefined) return []
  return [{ file: source ?? 'api.d.ts', revision: '', text }]
}

function kindGlyph(kind: string): string {
  if (kind === 'class') return 'C'
  if (kind === 'interface') return 'I'
  if (kind === 'callable') return 'ƒ'
  return 'T'
}

function uniqueSourceLabels(sources: readonly ApiSource[]): string[] {
  const segments = sources.map((source) => source.file.split('/').filter(Boolean))
  return segments.map((parts, index) => {
    for (let length = 1; length <= parts.length; length++) {
      const label = parts.slice(-length).join('/')
      if (
        segments.every(
          (candidate, candidateIndex) =>
            candidateIndex === index || candidate.slice(-length).join('/') !== label,
        )
      ) {
        return label
      }
    }
    return sources[index]?.file ?? 'api.d.ts'
  })
}

function namespacePaths(api: ApiModel, identity: string): string[] {
  const paths = new Set<string>()
  for (const item of api.surface.exports) {
    if (item.declaration !== identity) continue
    let path = ''
    for (const segment of item.path.slice(0, -1)) {
      path = path ? `${path}.${segment}` : segment
      paths.add(path)
    }
  }
  return [...paths]
}

function outlineGroupPaths(nodes: readonly ApiOutlineNode[]): Set<string> {
  const paths = new Set<string>()
  const collect = (items: readonly ApiOutlineNode[]) => {
    for (const item of items) {
      if (item.type !== 'group') continue
      paths.add(item.path)
      collect(item.children)
    }
  }
  collect(nodes)
  return paths
}

function mergeExpanded(current: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...current, ...added])].sort()
}

function navigationKey(navigation: ApiNavigationState): string {
  return JSON.stringify([navigation.source, navigation.declaration ?? null, navigation.expanded])
}

function DefinitionJumpIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.5h6.5v9H3z" />
      <path d="M7 8.5 13 2.5m-4 0h4v4" />
    </svg>
  )
}

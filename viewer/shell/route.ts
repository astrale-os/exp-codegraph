export const SPEC_TABS = [
  'api',
  'internal',
  'ports',
  'flows',
  'laws',
  'states',
  'limits',
  'layout',
  'code',
  'schemas',
  'artifacts',
  'packages',
  'rules',
  'decisions',
  'capabilities',
  'examples',
  'benchmarks',
  'architecture',
  'diagnostics',
  'manifest',
  'context',
  'history',
] as const

export type SpecTab = (typeof SPEC_TABS)[number]
export type ViewerRouteView = 'graph'

export interface ApiRouteState {
  readonly source: string
  readonly declaration?: string
  readonly expanded: readonly string[]
}

export interface Route {
  source?: string
  view?: ViewerRouteView
  pointer?: string
  tab?: SpecTab
  resource?: string
  api?: ApiRouteState
}

export function readRoute(location: Pick<Location, 'search'>): Route {
  const parameters = new URLSearchParams(location.search)
  const api = readApiRoute(parameters)
  const view = viewerRouteView(parameters.get('view'))
  return {
    source: parameters.get('spec') ?? undefined,
    pointer: parameters.has('at') ? (parameters.get('at') ?? '') : undefined,
    tab: specTab(parameters.get('tab')),
    ...(view ? { view } : {}),
    ...(parameters.has('resource') ? { resource: parameters.get('resource') ?? '' } : {}),
    ...(api ? { api } : {}),
  }
}

export function routeHref(
  source: string,
  pointer?: string,
  tab?: SpecTab,
  api?: ApiRouteState,
  resource?: string,
): string {
  return viewerRouteHref({ source, pointer, tab, api, resource })
}

export function graphRouteHref(): string {
  return viewerRouteHref({ view: 'graph' })
}

export function viewerRouteHref(route: Route): string {
  const parameters = new URLSearchParams()
  if (route.view) parameters.set('view', route.view)
  if (route.source) parameters.set('spec', route.source)
  const { pointer, tab, api, resource } = route
  if (pointer !== undefined) parameters.set('at', pointer)
  if (tab !== undefined) parameters.set('tab', tab)
  if (resource !== undefined) parameters.set('resource', resource)
  if (api) {
    parameters.set('apiFile', api.source)
    if (api.declaration !== undefined) parameters.set('apiDecl', api.declaration)
    for (const path of [...new Set(api.expanded)].sort()) parameters.append('apiOpen', path)
  }
  return `?${parameters}`
}

function viewerRouteView(value: string | null): ViewerRouteView | undefined {
  return value === 'graph' ? value : undefined
}

function readApiRoute(parameters: URLSearchParams): ApiRouteState | undefined {
  if (!parameters.has('apiFile') && !parameters.has('apiDecl') && !parameters.has('apiOpen')) {
    return undefined
  }
  return {
    source: parameters.get('apiFile') ?? '',
    ...(parameters.has('apiDecl') ? { declaration: parameters.get('apiDecl') ?? '' } : {}),
    expanded: [...new Set(parameters.getAll('apiOpen'))].sort(),
  }
}

function specTab(value: string | null): SpecTab | undefined {
  return SPEC_TABS.find((candidate) => candidate === value)
}

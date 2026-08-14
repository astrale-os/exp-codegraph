import type { ModuleSourceReference } from '../../specification/resource/index.ts'
import type { ViewerSpecification } from '../../viewer-host/catalog.ts'
import type { SpecTab } from '../shell/route.ts'
import type { ApiDefinitionOwner } from './api.tsx'

import { routeHref } from '../shell/route.ts'

export interface ModuleSourceLink {
  readonly from: number
  readonly to: number
  readonly href: string
  readonly title: string
}

export function moduleSourceLinks(
  spec: ViewerSpecification,
  source: string,
  owners?: ReadonlyMap<string, ApiDefinitionOwner>,
): ModuleSourceLink[] {
  return spec.sourceReferences.flatMap((reference) => {
    if (reference.source !== source) return []
    const target = moduleSourceReferenceTarget(spec, reference, owners)
    return target ? [{ from: reference.from, to: reference.to, ...target }] : []
  })
}

export function moduleSourceReferenceTarget(
  spec: ViewerSpecification,
  reference: ModuleSourceReference,
  owners?: ReadonlyMap<string, ApiDefinitionOwner>,
): { readonly href: string; readonly title: string } | undefined {
  const localTab = moduleResourceTab(spec, reference.target.source)
  if (localTab) {
    return localTab === 'api'
      ? apiTarget(spec.source, reference, spec.title)
      : {
          href: routeHref(spec.source, undefined, localTab, undefined, reference.target.source),
          title: `Open ${resourceTitle(reference.target.source)} in ${tabTitle(localTab)}`,
        }
  }

  const owner = declarationOwner(owners, reference.target.declaration)
  if (owner) return apiTarget(owner.source, reference, owner.title)

  if (isModuleApi(reference.target.source)) {
    return apiTarget(
      reference.target.source,
      reference,
      moduleTitleFromApi(reference.target.source),
    )
  }
  return
}

export function moduleResourceTab(spec: ViewerSpecification, source: string): SpecTab | undefined {
  if (spec.modules.some((module) => module.api?.source === source)) return 'api'
  if (spec.modules.some((module) => module.ports.some((port) => port.source === source))) {
    return 'ports'
  }
  if (spec.examples.some((resource) => resource.source === source)) return 'examples'
  if (spec.schemas.some((resource) => resource.source === source)) return 'schemas'
  if (spec.internal?.source === source) return 'internal'
  if (spec.flows.some((resource) => resource.source === source)) return 'flows'
  if (spec.laws.some((resource) => resource.source === source)) return 'laws'
  if (spec.states.some((resource) => resource.source === source)) return 'states'
  if (spec.limits?.source === source) return 'limits'
  if (spec.layout?.source === source) return 'layout'
  if (spec.capabilities.some((resource) => resource.source === source)) {
    return 'capabilities'
  }
  if (spec.benchmarks.some((resource) => resource.source === source)) {
    return 'benchmarks'
  }
  return
}

export function resourceTitle(source: string): string {
  const file = source.split('/').at(-1) ?? source
  const stem = file
    .replace(/\.d\.[cm]?ts$/u, '')
    .replace(/\.schema\.json$/u, '')
    .replace(/\.[^.]+$/u, '')
  const words = stem
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[._-]+|\s+/u)
    .filter(Boolean)
  return words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ') || file
}

function apiTarget(
  source: string,
  reference: ModuleSourceReference,
  title: string,
): { readonly href: string; readonly title: string } {
  return {
    href: routeHref(source, undefined, 'api', {
      source: reference.target.source,
      ...(reference.target.declaration ? { declaration: reference.target.declaration } : {}),
      expanded: [],
    }),
    title: `Open ${reference.text} in ${title}`,
  }
}

function declarationOwner(
  owners: ReadonlyMap<string, ApiDefinitionOwner> | undefined,
  identity: string | undefined,
): ApiDefinitionOwner | undefined {
  if (!owners || !identity) return
  const exact = owners.get(identity)
  if (exact) return exact
  const member = identity.lastIndexOf('#')
  return member > identity.indexOf('#') ? owners.get(identity.slice(0, member)) : undefined
}

function isModuleApi(source: string): boolean {
  return source.endsWith('/.spec/api.d.ts') || source === '.spec/api.d.ts'
}

function moduleTitleFromApi(source: string): string {
  const root = source.replace(/\/?\.spec\/api\.d\.ts$/u, '')
  return root.split('/').filter(Boolean).join('.') || 'module'
}

function tabTitle(tab: SpecTab): string {
  return `${tab[0]?.toUpperCase() ?? ''}${tab.slice(1)}`
}

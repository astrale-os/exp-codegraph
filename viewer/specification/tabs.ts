import type { ViewerSpecification } from '../../viewer-host/specification.ts'
import type { Route, SpecTab } from '../shell/route.ts'

import { viewerSpecificationDiagnostics } from '../../viewer-host/specification.ts'

export interface SpecTabGroups {
  primary: SpecTab[]
  secondary: SpecTab[]
}

export interface DerivedSpecTabs {
  /** A catalog-derived child-module topology can provide Code without a root binding. */
  readonly code?: boolean
}

export interface DiagnosticsTabState {
  readonly status: 'pass' | 'fail' | 'error' | 'idle'
  readonly label: string
  readonly identity: number
  readonly title: string
}

export function diagnosticsTabState(spec: ViewerSpecification): DiagnosticsTabState {
  const validationDiagnostics = viewerSpecificationDiagnostics(spec)
  const failedRules =
    spec.verification?.rules.filter((rule) => rule.status === 'fail' || rule.status === 'error') ??
    []
  const diagnosticCount =
    validationDiagnostics.length +
    failedRules.reduce((count, rule) => count + rule.diagnostics.length, 0)
  const identity =
    spec.verification?.profiles.reduce(
      (count, profile) => count + (profile.evidence?.proof?.identityDeclarations.length ?? 0),
      0,
    ) ?? 0
  if (validationDiagnostics.length > 0) {
    return {
      status: 'fail',
      label: String(diagnosticCount),
      identity,
      title: `${diagnosticCount} validation or verification diagnostic${diagnosticCount === 1 ? '' : 's'}.`,
    }
  }
  if (!spec.modules.some((module) => module.contract)) {
    return {
      status: 'pass',
      label: 'valid',
      identity: 0,
      title: 'The specification document is structurally valid.',
    }
  }
  if (!spec.verification) {
    return {
      status: 'idle',
      label: 'not run',
      identity: 0,
      title: 'Code conformance has not been verified yet.',
    }
  }
  if (spec.verification.status === 'pass') {
    return {
      status: 'pass',
      label: 'conforms',
      identity,
      title: identity
        ? `The API conforms. ${identity} declaration${identity === 1 ? '' : 's'} intentionally use identity-only proof.`
        : 'The API conforms to the declared contract.',
    }
  }
  return {
    status: spec.verification.status,
    label: diagnosticCount ? String(diagnosticCount) : spec.verification.status,
    identity,
    title: diagnosticCount
      ? `${diagnosticCount} conformance diagnostic${diagnosticCount === 1 ? '' : 's'}.`
      : `Code conformance is ${spec.verification.status}.`,
  }
}

export function specTabGroups(
  spec: ViewerSpecification,
  derived: DerivedSpecTabs = {},
): SpecTabGroups {
  return {
    primary: [
      ...(spec.architecture ? (['architecture'] as const) : []),
      ...(spec.modules.some((module) => module.api) ? (['api'] as const) : []),
      ...(spec.examples.length ? (['examples'] as const) : []),
      ...(spec.capabilities.length ? (['capabilities'] as const) : []),
      ...(spec.flows.length ? (['flows'] as const) : []),
      ...(spec.laws.length ? (['laws'] as const) : []),
      ...(spec.states.length ? (['states'] as const) : []),
      ...(spec.limits ? (['limits'] as const) : []),
      ...(spec.layout ? (['layout'] as const) : []),
      ...(spec.modules.some((module) => module.ports.length) ? (['ports'] as const) : []),
      ...(spec.internal ? (['internal'] as const) : []),
      ...(spec.modules.some((module) => module.binding) || derived.code
        ? (['code'] as const)
        : []),
      ...(spec.schemas.length ? (['schemas'] as const) : []),
      ...(spec.modules.some((module) => module.packages.length) ? (['packages'] as const) : []),
      ...(spec.benchmarks.length ? (['benchmarks'] as const) : []),
    ],
    secondary: [
      'diagnostics',
      ...(spec.history.length || spec.historyDiagnostics.length ? (['history'] as const) : []),
    ],
  }
}

export function specTabs(spec: ViewerSpecification, derived: DerivedSpecTabs = {}): SpecTab[] {
  const { primary, secondary } = specTabGroups(spec, derived)
  return [...primary, ...secondary]
}

export function defaultSpecTab(
  spec: ViewerSpecification,
  _pointer?: string,
  derived: DerivedSpecTabs = {},
): SpecTab {
  if (specTabGroups(spec, derived).primary[0]) return specTabGroups(spec, derived).primary[0]
  return spec.history.length ? 'history' : 'diagnostics'
}

export function moduleNavigationTab(
  explicit: SpecTab | undefined,
  current: SpecTab | undefined,
  remembered: SpecTab | undefined,
): SpecTab | undefined {
  return explicit ?? current ?? remembered
}

export function selectedSpecTab(
  spec: ViewerSpecification,
  route: Route,
  remembered?: SpecTab,
  derived: DerivedSpecTabs = {},
): SpecTab {
  const available = specTabs(spec, derived)
  const candidate =
    route.source === spec.source
      ? (route.tab ??
        (route.pointer === undefined ? remembered : undefined) ??
        defaultSpecTab(spec, route.pointer, derived))
      : (remembered ?? defaultSpecTab(spec, undefined, derived))
  if (available.includes(candidate)) return candidate
  if (route.pointer === undefined && remembered && available.includes(remembered)) return remembered
  return defaultSpecTab(spec, route.pointer, derived)
}

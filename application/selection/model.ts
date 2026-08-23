import type { Diagnostic } from '../../source/diagnostic.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'
import type { TypeSpecApplicationSelection } from '../model.ts'

export interface SelectApplicationSpecificationsOptions {
  readonly select?: readonly string[]
  readonly focused?: boolean
  readonly includeDependents?: boolean
}

export interface SelectedApplicationSpecifications {
  readonly selection: TypeSpecApplicationSelection
  readonly included: readonly SpecificationSnapshot[]
  readonly qualification: readonly SpecificationSnapshot[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationSpecificationAnchor {
  readonly directory: string
  readonly source: string
  readonly root: string
  readonly title: string
}

export interface PlannedApplicationSpecificationAnchors {
  readonly requested: readonly string[]
  readonly primary: readonly ApplicationSpecificationAnchor[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface ApplicationDependencyOptimizationPlan {
  readonly outcome: 'planned' | 'fallback'
  readonly owners: readonly ApplicationSpecificationAnchor[]
  readonly inspectedSources: number
  readonly dependencyEdges: number
  readonly unavailableSources: number
  readonly reason?: string
}

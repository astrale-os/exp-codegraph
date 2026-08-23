import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'
import type { TypeSpecApplicationSelection } from '../../.spec/api.js'

interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointer?: string
}

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

export function applicationSpecificationAnchors(
  root: string,
  directories: readonly string[],
): readonly ApplicationSpecificationAnchor[]

export function planApplicationSpecificationAnchors(
  root: string,
  anchors: readonly ApplicationSpecificationAnchor[],
  select: readonly string[],
): PlannedApplicationSpecificationAnchors

export function selectApplicationSpecifications(
  root: string,
  specifications: readonly SpecificationSnapshot[],
  options?: SelectApplicationSpecificationsOptions,
): SelectedApplicationSpecifications

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

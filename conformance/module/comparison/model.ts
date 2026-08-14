import type { TypeScriptModuleTarget } from '../../../analysis/typescript/index.ts'
import type {
  ObservationIssue,
  ObservedDeclaration,
  ObservedExport,
  SourceLocation,
} from '../../../analysis/typescript/surface/index.ts'

export type {
  ObservedCallable,
  ObservedDeclaration,
  ObservedMember,
  ObservedType,
} from '../../../analysis/typescript/surface/index.ts'

export type EvaluationStatus = 'pass' | 'fail' | 'idle' | 'error'

export interface EvaluationLocation {
  readonly file?: string
  readonly external?: string
  readonly line?: number
  readonly column?: number
  readonly pointer?: string
  readonly label?: string
}

export interface EvaluationDiagnostic {
  readonly code?: string
  readonly message: string
  readonly severity?: 'error' | 'warning' | 'info'
  readonly location?: EvaluationLocation
  readonly related?: readonly EvaluationLocation[]
  readonly expected?: unknown
  readonly actual?: unknown
  readonly hint?: string
}

export interface EvaluationRule {
  readonly id: string
  status: EvaluationStatus
  diagnostics: EvaluationDiagnostic[]
}

export type ImplementationLocation = SourceLocation

export interface NormalizedDependencyOccurrence {
  readonly id: string
  readonly typeOnly: boolean
  readonly specifier: string
  readonly deep: boolean
  readonly location: ImplementationLocation
  readonly declaration?: string
  readonly publicPath?: readonly string[]
}

export interface NormalizedDependency {
  readonly id: string
  readonly sourceModule: string
  readonly targetModule: string
  readonly kind: 'api' | 'runtime' | 'type' | 'side-effect' | 'dynamic'
  readonly sourceFile: string
  readonly targetFile: string
  readonly occurrences: readonly NormalizedDependencyOccurrence[]
}

export interface NormalizedModule {
  readonly id: string
  readonly name: string
  readonly target: TypeScriptModuleTarget
  readonly exports: readonly ObservedExport[]
  readonly declarations: readonly ObservedDeclaration[]
  readonly dependencies: readonly NormalizedDependency[]
  readonly inboundDependencies: readonly NormalizedDependency[]
  readonly declaredPackages: readonly string[]
  readonly developmentPackages: readonly string[]
  readonly workspacePackages: readonly string[]
  readonly errorCodes: readonly { readonly code: string; readonly location: SourceLocation }[]
  readonly issues: readonly ObservationIssue[]
}

export interface NormalizedModuleCatalog {
  readonly knownModuleIds: readonly string[]
  readonly modules: readonly NormalizedModule[]
}

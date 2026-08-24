interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointer?: string
}

export const APPLICATION_BINDING_FACT_NAMESPACE: 'astrale.typespec.module-binding'

export interface ApplicationModuleBindingTarget {
  readonly id: string
  readonly name: string
  readonly project: string
  readonly root: string
  readonly entrypoint: string
  readonly facades: readonly string[]
  readonly aliases: readonly string[]
  readonly internals: readonly string[]
}

export interface ApplicationModuleBindingExportFacet {
  readonly type: boolean
  readonly value: boolean
  readonly typeOnly: boolean
}

export interface ApplicationModuleBindingExport {
  readonly path: readonly string[]
  readonly name: string
  readonly contract: ApplicationModuleBindingExportFacet
  readonly implementation: ApplicationModuleBindingExportFacet
  readonly status: 'pass' | 'missing' | 'undeclared' | 'incompatible'
}

export interface ApplicationModuleBindingDiagnostic extends Diagnostic {
  readonly exportPath?: string
  readonly expected?: string
  readonly actual?: string
}

export interface ApplicationModuleBindingDependency {
  readonly targetModule: string
  readonly kind: 'api' | 'runtime' | 'type' | 'side-effect' | 'dynamic'
  readonly sourceFile: string
  readonly targetFile: string
  readonly specifier: string
  readonly typeOnly: boolean
  readonly deep: boolean
  readonly line: number
  readonly column: number
}

export interface ApplicationModuleBindingFact {
  readonly specification: string
  readonly target: ApplicationModuleBindingTarget
  readonly exports: readonly ApplicationModuleBindingExport[]
  readonly dependencies: readonly ApplicationModuleBindingDependency[]
  readonly declaredPackages: readonly string[]
  readonly developmentPackages: readonly string[]
  readonly errorCodes: readonly string[]
  readonly expectedErrorCodes: readonly string[]
  readonly files: readonly string[]
  readonly diagnostics: readonly ApplicationModuleBindingDiagnostic[]
}

export interface ApplicationModuleBindingRequest {
  readonly specification: string
  readonly source: string
  readonly target: ApplicationModuleBindingTarget
}

export interface ApplicationModuleBindingWork {
  readonly programs: number
  readonly sourceFiles: number
  readonly durationMs: number
  readonly programMs: number
  readonly diagnosticsMs: number
  readonly surfaceMs: number
  readonly exportsMs: number
  readonly dependenciesMs: number
  readonly evidenceMs: number
  readonly workerPeakResidentBytes: number
  readonly workerResidentUpperBoundBytes: number
}

export interface ApplicationModuleBindingCompilation extends ApplicationModuleBindingWork {
  readonly facts: readonly ApplicationModuleBindingFact[]
}

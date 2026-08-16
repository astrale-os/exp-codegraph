import type { Diagnostic } from '../source/diagnostic.ts'
import type { ImplementationBinding } from '../specification/binding.ts'
import type {
  BenchmarkResource,
  CapabilityResource,
  CodeDeclarationResource,
  DeclarationResource,
  ExampleResource,
  HistoryResource,
  LawResource,
  LayoutResource,
  MarkdownResource,
  ModuleCodeResource,
  ModuleIconResource,
  ModuleSourceReference,
  PackagePatternResource,
  PackageSpecificationResource,
  PortResource,
  SchemaResource,
  StateResource,
} from '../specification/resource/index.ts'
import type { ViewerCodeAnalysis } from './code.ts'
import type { ViewerQualification } from './qualification.ts'

export interface ViewerModuleContractImport {
  readonly key: string
  readonly source: string
}

export interface ViewerModuleContract {
  readonly id: string
  readonly imports: readonly ViewerModuleContractImport[]
}

export interface ViewerSpecificationModule {
  readonly id: string
  readonly name: string
  readonly declarationPointer: string
  readonly specifier?: string
  readonly api?: DeclarationResource
  readonly ports: readonly PortResource[]
  readonly binding?: ImplementationBinding
  readonly packages: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
  readonly code?: ViewerCodeAnalysis
  readonly contract?: ViewerModuleContract
}

/** Browser projection only; normative and observed authorities remain in V2 snapshots/facts. */
export interface ViewerSpecification {
  readonly title: string
  readonly source: string
  readonly modules: readonly ViewerSpecificationModule[]
  readonly schemas: readonly SchemaResource[]
  readonly examples: readonly ExampleResource[]
  readonly diagnostics: readonly Diagnostic[]
  readonly specRevision: string
  readonly verificationRevision: string
  readonly root: string
  readonly code?: CodeDeclarationResource
  readonly icon?: ModuleIconResource
  readonly internal?: DeclarationResource
  readonly capabilities: readonly CapabilityResource[]
  readonly flows: readonly ModuleCodeResource[]
  readonly laws: readonly LawResource[]
  readonly states: readonly StateResource[]
  readonly limits?: ModuleCodeResource
  readonly layout?: LayoutResource
  readonly benchmarks: readonly BenchmarkResource[]
  readonly packages: readonly PackageSpecificationResource[]
  readonly packagePatterns: readonly PackagePatternResource[]
  readonly architecture?: MarkdownResource
  readonly sourceReferences: readonly ModuleSourceReference[]
  readonly history: readonly HistoryResource[]
  readonly historyRevision: string
  readonly historyDiagnostics: readonly Diagnostic[]
  readonly contracts: readonly string[]
  readonly verification?: ViewerQualification
}

export interface ViewerCatalog {
  readonly specs: readonly ViewerSpecification[]
  readonly diagnostics: readonly Diagnostic[]
  readonly selection?: {
    readonly requested: readonly string[]
    readonly selectedSources: readonly string[]
    readonly selectedModuleIds: readonly string[]
    readonly supportModuleIds: readonly string[]
  }
}

export function viewerSpecificationDiagnostics(
  specification: Pick<ViewerSpecification, 'diagnostics'> & {
    readonly modules: readonly Pick<ViewerSpecificationModule, 'diagnostics'>[]
  },
): readonly Diagnostic[] {
  return [
    ...specification.diagnostics,
    ...specification.modules.flatMap((module) => module.diagnostics),
  ]
}

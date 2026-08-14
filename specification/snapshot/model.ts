import type { Diagnostic } from '../../source/diagnostic.ts'
import type { ApiModelV2 } from '../../api/model.ts'
import type {
  BenchmarkResource,
  CapabilityResource,
  CodeDeclarationResource,
  DeclarationResource,
  ExampleResource,
  LawSpecification,
  ModuleCodeResource,
  ModuleSourceReference,
  PackagePatternResource,
  PackageSpecificationResource,
  PortResource,
  SchemaResource,
  StateSpecification,
  TextResource,
} from '../resource/index.ts'

export type SpecificationSnapshotId = `specification:${string}`

export type SpecificationDeclarationResource = DeclarationResource<ApiModelV2>
export type SpecificationPortResource = PortResource<ApiModelV2>

export type AuthoredLawSpecification = Omit<LawSpecification, 'testEvidence'>
export type AuthoredStateSpecification = Omit<StateSpecification, 'testEvidence'>

export interface AuthoredLawResource extends Omit<CapabilityResource, 'kind' | 'definitions'> {
  readonly kind: 'law'
  readonly definitions: readonly AuthoredLawSpecification[]
}

export interface AuthoredStateResource extends Omit<CapabilityResource, 'kind' | 'definitions'> {
  readonly kind: 'state'
  readonly definitions: readonly AuthoredStateSpecification[]
}

export interface AuthoredLayoutResource extends TextResource {
  readonly entries: readonly { readonly path: string; readonly kind: 'directory' | 'file' }[]
  readonly exact: boolean
  readonly ignore: readonly string[]
}

export interface SpecificationPackageAuthority {
  readonly source: string
  readonly packages: readonly PackageSpecificationResource[]
  readonly packagePatterns: readonly PackagePatternResource[]
}

export interface SpecificationModuleSnapshot {
  readonly id: string
  readonly name: string
  readonly declarationPointer: ''
  readonly api?: SpecificationDeclarationResource
  readonly code?: CodeDeclarationResource
  readonly internal?: SpecificationDeclarationResource
  readonly ports: readonly SpecificationPortResource[]
  /** Effective package-root intent, retained with its authored provenance. */
  readonly packageAuthority: SpecificationPackageAuthority
  readonly packages: readonly string[]
}

/**
 * One immutable normative compilation of a convention-based `.spec` module.
 *
 * It deliberately contains no implementation binding, resolved test, filesystem
 * observation, verification result, presentation model, or mutable catalog state.
 */
export interface SpecificationSnapshot {
  readonly format: 'astrale.typespec.specification'
  readonly version: 2
  readonly id: SpecificationSnapshotId
  readonly revision: string
  readonly source: string
  readonly title: string
  readonly root: string
  readonly module: SpecificationModuleSnapshot
  readonly schemas: readonly SchemaResource[]
  readonly examples: readonly ExampleResource[]
  readonly capabilities: readonly CapabilityResource[]
  readonly flows: readonly ModuleCodeResource[]
  readonly laws: readonly AuthoredLawResource[]
  readonly states: readonly AuthoredStateResource[]
  readonly limits?: ModuleCodeResource
  readonly layout?: AuthoredLayoutResource
  readonly benchmarks: readonly BenchmarkResource[]
  readonly packages: readonly PackageSpecificationResource[]
  readonly packagePatterns: readonly PackagePatternResource[]
  readonly sourceReferences: readonly ModuleSourceReference[]
  readonly diagnostics: readonly Diagnostic[]
}

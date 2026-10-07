interface Diagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointer?: string
}

interface TextResource {
  readonly ref: string
  readonly source: string
  readonly text: string
  readonly revision: string
}

interface DeclarationResource extends TextResource {
  /** Normalized expected declaration contract; never an implementation observation. */
  readonly model?: unknown
}

interface PortResource extends DeclarationResource {
  readonly declarationPointer: string
  readonly namespace?: string
  readonly port: { readonly name: string; readonly declaration: string }
}

interface DescriptorResource<Kind extends string, Definition> extends TextResource {
  readonly kind: Kind
  readonly definitions: readonly Definition[]
}

interface CapabilityDefinition {
  readonly exportName: string
  readonly id: string
  readonly statement: string
}

/** A string cites the citing module; the object form cites a strict descendant module. */
type SemanticReference = string | { readonly module: string; readonly id: string }

interface CapabilitySpecification extends CapabilityDefinition {
  readonly laws?: readonly SemanticReference[]
  readonly capabilities?: readonly SemanticReference[]
}

interface TestEvidenceReference {
  readonly file: string
  readonly id: string
}

export interface AuthoredLawSpecification {
  readonly exportName: string
  readonly id: string
  readonly statement: string
  readonly formal?: string
  readonly tests?: readonly TestEvidenceReference[]
}

export interface AuthoredStateSpecification {
  readonly exportName: string
  readonly initial?: string
  readonly transitions: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly tests?: readonly TestEvidenceReference[]
}

interface BenchmarkDefinition extends CapabilityDefinition {
  readonly workload: string
  readonly metrics: readonly string[]
  readonly capability?: string
  readonly assumptions?: readonly string[]
}

export type DescriptorKind = 'capability' | 'law' | 'state' | 'benchmark'

export interface DescriptorDefinitions {
  readonly capability: readonly CapabilitySpecification[]
  readonly law: readonly AuthoredLawSpecification[]
  readonly state: readonly AuthoredStateSpecification[]
  readonly benchmark: readonly BenchmarkDefinition[]
}

export interface DescriptorCompilation<Kind extends DescriptorKind> {
  readonly definitions: DescriptorDefinitions[Kind]
  readonly diagnostics: readonly Diagnostic[]
}

/** Parse one authored descriptor resource without importing or executing it. */
export function compileDescriptor<Kind extends DescriptorKind>(
  kind: Kind,
  source: string,
  text: string,
): DescriptorCompilation<Kind>

interface SchemaResource extends TextResource {
  readonly schema: unknown
}

interface ExampleResource extends TextResource {
  readonly against: 'api' | 'code'
  readonly declarationPointer: string
}

interface ModuleCodeResource extends TextResource {
  readonly kind: 'flow' | 'limits'
}

interface CodeDeclarationResource extends TextResource {
  readonly internals: readonly string[]
}

interface PackageSpecificationResource extends TextResource {
  readonly package: string
  readonly purpose: string
}

interface PackagePatternResource extends TextResource {
  readonly pattern: string
  readonly reason: string
}

interface ModuleSourceReference {
  readonly source: string
  readonly from: number
  readonly to: number
  readonly text: string
  readonly target: {
    readonly source: string
    readonly from: number
    readonly line: number
    readonly column: number
    readonly declaration?: string
  }
}

export type SpecificationSnapshotId = `specification:${string}`

type CapabilityResource = DescriptorResource<'capability', CapabilitySpecification>
export type AuthoredLawResource = DescriptorResource<'law', AuthoredLawSpecification>
export type AuthoredStateResource = DescriptorResource<'state', AuthoredStateSpecification>

export interface AuthoredLayoutResource extends TextResource {
  readonly entries: readonly { readonly path: string; readonly kind: 'directory' | 'file' }[]
  readonly exact: boolean
  readonly ignore: readonly string[]
}

export interface SpecificationModuleSnapshot {
  readonly id: string
  readonly name: string
  readonly declarationPointer: ''
  readonly api?: DeclarationResource
  readonly code?: CodeDeclarationResource
  readonly internal?: DeclarationResource
  readonly ports: readonly PortResource[]
  readonly packageAuthority: {
    readonly source: string
    readonly packages: readonly PackageSpecificationResource[]
    readonly packagePatterns: readonly PackagePatternResource[]
  }
  readonly packages: readonly string[]
}

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
  readonly benchmarks: readonly DescriptorResource<'benchmark', BenchmarkDefinition>[]
  readonly packages: readonly PackageSpecificationResource[]
  readonly packagePatterns: readonly PackagePatternResource[]
  readonly sourceReferences: readonly ModuleSourceReference[]
  readonly diagnostics: readonly Diagnostic[]
}

export type CapabilityStatus = 'declared' | 'partial' | 'held'

/** One semantic identifier addressed by its catalog-relative module root. */
export interface CapabilityCoordinate {
  readonly module: string
  readonly id: string
}

export interface CapabilityDerivationModule {
  readonly root: string
  readonly capabilities: readonly CapabilityResource[]
  /** Declared laws, each with whether at least one active test declaration is attached. */
  readonly laws: readonly { readonly id: string; readonly active: boolean }[]
}

export interface DerivedCapability extends CapabilityCoordinate {
  readonly source: string
  readonly status: CapabilityStatus
  /** Cited laws without an active test and cited capabilities that are not held. */
  readonly blocking: {
    readonly laws: readonly CapabilityCoordinate[]
    readonly capabilities: readonly CapabilityCoordinate[]
  }
}

/** Public-contract anchors of every descendant module cited by one module's capabilities. */
export function capabilityReferenceSources(specification: {
  readonly root: string
  readonly capabilities: readonly CapabilityResource[]
}): readonly string[]

/** Derive reported capability statuses; a status is never a diagnostic. */
export function deriveCapabilityStatuses(
  modules: readonly CapabilityDerivationModule[],
): readonly DerivedCapability[]

/** Compile authored `.spec` meaning without implementation, test, layout, or UI observations. */
export function compileSpecificationSnapshot(
  root: string,
  specDirectory: string,
): Promise<SpecificationSnapshot>

export interface SpecificationCompilationBatchOptions {
  readonly maximumConcurrency?: number
  readonly onPhase?: (phase: SpecificationCompilationPhase) => void
  /** Restorable candidates admitted only when the exact delta cannot affect declarations. */
  readonly previous?: readonly SpecificationSnapshot[]
  /** Exact inventory delta used to reject unsafe declaration restoration. */
  readonly changed?: readonly string[]
  /** Include presentation-only source navigation in declaration models. */
  readonly includeDeclarationNavigation?: boolean
  /** Include complete normalized declaration models after exact diagnostics pass. */
  readonly includeDeclarationModels?: boolean
}

export interface SpecificationCompilationPhase {
  readonly phase: 'inventory' | 'declarations' | 'typescript' | 'snapshots'
  readonly durationMs: number
  readonly items: number
  readonly programs?: number
  readonly sessions?: number
  readonly retries?: number
  readonly fallbacks?: number
  readonly workerPeakResidentBytes?: number
  readonly workerResidentUpperBoundBytes?: number
  readonly parentPeakResidentBytes?: number
  /** TypeScript wall time remaining after snapshot work was scheduled. */
  readonly typeScriptTailAfterSnapshotSchedulingMs?: number
}

/** Compile one coherent corpus through bounded shared declaration and TypeScript waves. */
export function compileSpecificationSnapshots(
  root: string,
  specDirectories: readonly string[],
  options?: SpecificationCompilationBatchOptions,
): Promise<readonly SpecificationSnapshot[]>

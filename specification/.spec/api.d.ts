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
  readonly capability: readonly CapabilityDefinition[]
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
  readonly capabilities: readonly DescriptorResource<'capability', CapabilityDefinition>[]
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

/** Compile authored `.spec` meaning without implementation, test, layout, or UI observations. */
export function compileSpecificationSnapshot(
  root: string,
  specDirectory: string,
): Promise<SpecificationSnapshot>

export interface SpecificationCompilationBatchOptions {
  readonly maximumConcurrency?: number
}

/** Compile one coherent corpus through bounded shared declaration and TypeScript waves. */
export function compileSpecificationSnapshots(
  root: string,
  specDirectories: readonly string[],
  options?: SpecificationCompilationBatchOptions,
): Promise<readonly SpecificationSnapshot[]>

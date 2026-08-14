import type { ApiModel, ApiModelV2 } from '../api/model.ts'
import type { TestEvidenceReference } from '../authoring/evidence.ts'
import type {
  BenchmarkDefinition,
  CapabilityDefinition,
  LawDefinition,
} from '../authoring/index.ts'
import type { MarkdownDocument } from '../markdown/model.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { ImplementationBinding } from './binding.ts'

export interface TextResource {
  readonly ref: string
  readonly source: string
  readonly text: string
  readonly revision: string
}

export interface DeclarationResource<Model extends ApiModel = ApiModelV2> extends TextResource {
  readonly model?: Model
}

/** One locally declared interface participating in an outbound Port resource. */
export interface PortInterface {
  readonly name: string
  readonly declaration: string
}

/** One outbound Port declaration resource, optionally presented as a namespace group. */
export interface PortResource<Model extends ApiModel = ApiModelV2> extends DeclarationResource<Model> {
  /** Profile-relative source pointer that declared this resource. */
  readonly declarationPointer: string
  readonly namespace?: string
  readonly port: PortInterface
}

export interface MarkdownResource {
  readonly ref: string
  readonly document: MarkdownDocument
}

export interface SchemaResource extends TextResource {
  readonly schema: unknown
}

export interface ExampleResource extends TextResource {
  readonly against: 'api' | 'code'
  readonly declarationPointer: string
}

export interface ExportedDefinition {
  readonly exportName: string
}

export type CapabilitySpecification = CapabilityDefinition & ExportedDefinition
export type TestEvidenceStatus = 'active' | 'skipped' | 'todo'

/** A statically resolved test declaration attached as evidence, not a claim that the test passes. */
export interface TestEvidence {
  readonly reference: string
  readonly id: string
  readonly source: string
  readonly title: string
  readonly status: TestEvidenceStatus
  readonly line: number
  readonly column: number
  readonly code: string
  readonly revision: string
}

export type LawSpecification = LawDefinition &
  ExportedDefinition & {
    readonly testEvidence: readonly TestEvidence[]
  }
export type BenchmarkSpecification = BenchmarkDefinition & ExportedDefinition

export interface StateSpecification extends ExportedDefinition {
  readonly initial?: string
  readonly transitions: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly tests?: readonly TestEvidenceReference[]
  readonly testEvidence: readonly TestEvidence[]
}

export interface ModuleCodeResource extends TextResource {
  readonly kind: 'flow' | 'limits'
}

/** Statically authored additions to the convention-inferred implementation boundary. */
export interface CodeDeclarationResource extends TextResource {
  readonly internals: readonly string[]
}

/** One catalog-admitted SVG element. Authored SVG text never crosses into the viewer directly. */
export interface SvgIconElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly SvgIconElement[]
}

/** Optional presentation identity for one convention-based module specification. */
export interface ModuleIconResource extends TextResource {
  readonly icon: SvgIconElement
}

/** One statically resolved reference between TypeScript specification sources. */
export interface ModuleSourceReference {
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

export interface ModuleDescriptorResource<
  Kind extends 'capability' | 'law' | 'state' | 'benchmark',
  Definition,
> extends TextResource {
  readonly kind: Kind
  readonly definitions: readonly Definition[]
}

export type CapabilityResource = ModuleDescriptorResource<'capability', CapabilitySpecification>
export type LawResource = ModuleDescriptorResource<'law', LawSpecification>
export type StateResource = ModuleDescriptorResource<'state', StateSpecification>
export type BenchmarkResource = ModuleDescriptorResource<'benchmark', BenchmarkSpecification>
export type ModuleSourceResource =
  | ModuleCodeResource
  | CodeDeclarationResource
  | CapabilityResource
  | LawResource
  | StateResource
  | BenchmarkResource
  | LayoutResource

export interface PackageSpecificationResource extends TextResource {
  readonly package: string
  readonly purpose: string
}

export interface PackagePatternResource extends TextResource {
  readonly pattern: string
  readonly reason: string
}

export type LayoutPathKind = 'directory' | 'file'
export type LayoutObservedKind = LayoutPathKind | 'symbolic-link' | 'other'
export type LayoutEntryStatus = 'matched' | 'missing' | 'mismatch'

/** One normative physical path declaration in `.spec/layout.ts`. */
export interface LayoutEntry {
  readonly path: string
  readonly kind: LayoutPathKind
}

export interface LayoutEntryObservation {
  readonly path: string
  readonly status: LayoutEntryStatus
  readonly observedKind?: LayoutObservedKind
}

export interface LayoutAdditionalPath {
  readonly path: string
  readonly kind: LayoutObservedKind
}

export type LayoutIgnorePatternSource = 'default' | 'layout'

/** One effective filesystem-observation exclusion shown by the viewer. */
export interface LayoutIgnorePattern {
  readonly pattern: string
  readonly source: LayoutIgnorePatternSource
}

/** Filesystem evidence derived from, but not part of, the normative layout declaration. */
export interface LayoutObservation {
  readonly entries: readonly LayoutEntryObservation[]
  readonly additional: readonly LayoutAdditionalPath[]
  readonly revision: string
}

export interface LayoutResource extends TextResource {
  readonly entries: readonly LayoutEntry[]
  /** Exact maps reject additional non-ignored paths; sparse maps only observe them. */
  readonly exact?: boolean
  readonly ignore?: readonly LayoutIgnorePattern[]
  readonly observation: LayoutObservation
}

export type HistoryPresentation = 'markdown' | 'text' | 'pdf' | 'image' | 'binary'

export interface HistoryResource {
  readonly ref: string
  readonly source: string
  readonly name: string
  readonly mediaType: string
  readonly presentation: HistoryPresentation
  readonly size: number
  readonly revision: string
  readonly text?: string
  readonly document?: MarkdownDocument
}

/** One independently importable TypeScript module governed by its parent specification. */
export interface SpecModule {
  /** Stable catalog identity; distinct from the specification anchor shared by sibling modules. */
  readonly id: string
  readonly name: string
  /** Profile-relative pointer to this module declaration; empty for the primary module. */
  readonly declarationPointer: string
  readonly specifier?: string
  readonly api?: DeclarationResource
  readonly ports: readonly PortResource[]
  readonly binding?: ImplementationBinding
  /** Package dependencies explicitly named by this specification profile. */
  readonly packages: readonly string[]
  /** Diagnostics produced while loading and validating this specification module. */
  readonly diagnostics: Diagnostic[]
}

export interface ModuleSpecification {
  readonly title: string
  readonly source: string
  readonly modules: readonly SpecModule[]
  readonly schemas: readonly SchemaResource[]
  readonly examples: readonly ExampleResource[]
  readonly diagnostics: Diagnostic[]
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
}

export function contractDiagnostics(spec: ModuleSpecification): Diagnostic[] {
  return [...spec.diagnostics, ...spec.modules.flatMap((module) => module.diagnostics ?? [])]
}

export function resourceSources(spec: ModuleSpecification): string[] {
  return collectResourceSources(spec, true, true)
}

/** Text sources that may be replaced through the source-editing protocol. */
export function editableResourceSources(spec: ModuleSpecification): string[] {
  return collectResourceSources(spec, false, false)
}

function collectResourceSources(
  spec: ModuleSpecification,
  includeModuleContext: boolean,
  includeTestEvidence: boolean,
): string[] {
  const common = [
    spec.source,
    ...spec.modules.flatMap((module) =>
      [...(module.api ? [module.api] : []), ...module.ports].flatMap((resource) => [
        resource.source,
        ...apiSources(resource),
      ]),
    ),
    ...spec.schemas.map((resource) => resource.source),
    ...spec.examples.map((resource) => resource.source),
  ]
  const profile = [
    ...(spec.icon ? [spec.icon.source] : []),
    ...(spec.internal ? [spec.internal.source] : []),
    ...moduleSources(spec).map((resource) => resource.source),
    ...spec.packages.map((resource) => resource.source),
    ...spec.packagePatterns.map((resource) => resource.source),
    ...(spec.architecture ? [spec.architecture.document.source] : []),
    ...(includeModuleContext ? spec.history.map((resource) => resource.source) : []),
    ...(includeTestEvidence
      ? [...spec.laws, ...spec.states].flatMap((resource) =>
          resource.definitions.flatMap((definition) =>
            definition.testEvidence.map((evidence) => evidence.source),
          ),
        )
      : []),
  ]
  return [
    ...common,
    ...profile,
    ...contractDiagnostics(spec).map((diagnostic) => diagnostic.file),
  ].filter((source, index, values) => values.indexOf(source) === index)
}

/** Deterministic identity namespace for one module inside a specification. */
export function specModuleId(source: string, declarationPointer: string): string {
  return declarationPointer ? `${source}#${declarationPointer}` : source
}

function apiSources(resource: DeclarationResource): string[] {
  return resource.model?.sources.map((source) => source.file) ?? []
}

function moduleSources(spec: ModuleSpecification): ModuleSourceResource[] {
  return [
    ...(spec.code ? [spec.code] : []),
    ...spec.capabilities,
    ...spec.flows,
    ...spec.laws,
    ...spec.states,
    ...(spec.limits ? [spec.limits] : []),
    ...(spec.layout ? [spec.layout] : []),
    ...spec.benchmarks,
  ]
}

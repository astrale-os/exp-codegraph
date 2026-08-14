import type { ApiModel, ApiModelV2 } from '../../api/model.ts'
import type { TestEvidenceReference } from '../../authoring/evidence.ts'
import type {
  BenchmarkDefinition,
  CapabilityDefinition,
  LawDefinition,
} from '../../authoring/index.ts'
import type { MarkdownDocument } from '../../markdown/model.ts'

export interface TextResource {
  readonly ref: string
  readonly source: string
  readonly text: string
  readonly revision: string
}

export interface DeclarationResource<Model extends ApiModel = ApiModelV2> extends TextResource {
  readonly model?: Model
}

export interface PortInterface {
  readonly name: string
  readonly declaration: string
}

export interface PortResource<Model extends ApiModel = ApiModelV2> extends DeclarationResource<Model> {
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

export interface CodeDeclarationResource extends TextResource {
  readonly internals: readonly string[]
}

export interface SvgIconElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly SvgIconElement[]
}

export interface ModuleIconResource extends TextResource {
  readonly icon: SvgIconElement
}

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

export interface LayoutIgnorePattern {
  readonly pattern: string
  readonly source: LayoutIgnorePatternSource
}

export interface LayoutObservation {
  readonly entries: readonly LayoutEntryObservation[]
  readonly additional: readonly LayoutAdditionalPath[]
  readonly revision: string
}

export interface LayoutResource extends TextResource {
  readonly entries: readonly LayoutEntry[]
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

export type SpecificationResource =
  | TextResource
  | MarkdownResource
  | ModuleIconResource
  | HistoryResource

import type { ApiModelV2, ApiSource, ApiToken } from '../api/model.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { DeclarationResource, PortResource, SvgIconElement } from '../specification/resource/index.ts'
import type {
  ViewerSpecification as ViewerSpecificationProjection,
  ViewerSpecificationModule,
} from './specification.ts'

import { viewerSpecificationDiagnostics } from './specification.ts'


export const CATALOG_INDEX_FORMAT = 'astrale.spec.catalog-index' as const
export const CATALOG_SPEC_FORMAT = 'astrale.spec.catalog-spec' as const
export const CATALOG_SOURCE_FORMAT = 'astrale.spec.catalog-source' as const
export const CATALOG_TRANSPORT_VERSION = 2 as const

export const CATALOG_SPEC_ENDPOINT = '/__astrale/spec-catalog/spec'
export const CATALOG_SOURCE_ENDPOINT = '/__astrale/spec-catalog/source'
export const HISTORY_RESOURCE_ENDPOINT = '/__astrale/spec-history'

export interface CatalogSpecMetrics {
  readonly errors: number
  readonly open: number
  readonly status: 'error' | 'fail' | 'idle' | 'ok' | 'pass' | 'pending'
}

/** Compact catalog-index projection of one specification-level contract dependency. */
export interface CatalogSpecDependency {
  /** Owning specification anchor of the imported declaration. */
  readonly source: string
  /** Number of distinct imported declarations owned by that specification. */
  readonly declarations: number
}

/** Navigation and revision state required before any complete specification is loaded. */
export interface CatalogSpecEntry {
  readonly source: string
  readonly title: string
  /** Compact searchable projection for the module specification. */
  readonly searchText?: string
  readonly revision: string
  readonly snapshot: `application:${string}`
  readonly metrics: CatalogSpecMetrics
  /** Catalog-admitted module icon used before the complete specification payload is loaded. */
  readonly icon?: SvgIconElement
  /** TypeScript declaration identities canonically owned by this Spec's API. */
  readonly apiDeclarationIdentities?: readonly string[]
  /** Cross-spec API dependencies derived from the compiled module contract. */
  readonly contractDependencies?: readonly CatalogSpecDependency[]
}

/** One coherent catalog generation. Every entry points to an immutable Spec payload. */
export interface CatalogIndex {
  readonly format: typeof CATALOG_INDEX_FORMAT
  readonly version: typeof CATALOG_TRANSPORT_VERSION
  readonly generation: string
  /** Exact V2 application snapshot from which every payload and adapter was projected. */
  readonly snapshot: `application:${string}`
  readonly specs: readonly CatalogSpecEntry[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface PackedApiModel extends Omit<ApiModelV2, 'sources' | 'tokens'> {
  readonly sourceKeys: readonly string[]
}

export interface PackedDeclarationResource extends Omit<DeclarationResource, 'model'> {
  readonly model?: PackedApiModel
}

export interface PackedPortResource extends Omit<PortResource, 'model'> {
  readonly model?: PackedApiModel
}

export interface PackedSpecModule extends Omit<ViewerSpecificationModule, 'api' | 'ports'> {
  readonly api?: PackedDeclarationResource
  readonly ports: readonly PackedPortResource[]
}

export type CatalogSemanticReferenceKind =
  | 'callable'
  | 'class'
  | 'factory'
  | 'interface'
  | 'member'
  | 'namespace'
  | 'unsupported'
  | 'value'

export interface CatalogSemanticReferenceTarget {
  /** Owning specification anchor. */
  readonly spec: string
  /** Declaration source used to initialize API navigation. */
  readonly source: string
  readonly declaration: string
  readonly kind: CatalogSemanticReferenceKind
}

export interface CatalogSemanticReference {
  readonly from: number
  readonly to: number
  readonly text: string
  readonly target: CatalogSemanticReferenceTarget
}

export interface CatalogLawReferences {
  readonly statement?: readonly CatalogSemanticReference[]
  readonly formal?: readonly CatalogSemanticReference[]
}

/** Catalog-revision projection; never authored specification truth. */
export interface CatalogSemanticReferences {
  readonly laws: Readonly<Record<string, CatalogLawReferences>>
}

/** Complete Spec structure with declaration source bodies replaced by content-addressed keys. */
type PackSpecification<Specification extends ViewerSpecificationProjection> = Specification extends unknown
  ? Omit<Specification, 'modules'> & { readonly modules: readonly PackedSpecModule[] }
  : never

export type PackedSpec = PackSpecification<ViewerSpecificationProjection>

export type ViewerSpecification = ViewerSpecificationProjection & {
  readonly semanticReferences?: CatalogSemanticReferences
}

export interface CatalogSpecPayload {
  readonly format: typeof CATALOG_SPEC_FORMAT
  readonly version: typeof CATALOG_TRANSPORT_VERSION
  readonly source: string
  readonly revision: string
  readonly snapshot: `application:${string}`
  readonly spec: PackedSpec
  readonly semanticReferences?: CatalogSemanticReferences
}

export interface CatalogSourcePayload {
  readonly format: typeof CATALOG_SOURCE_FORMAT
  readonly version: typeof CATALOG_TRANSPORT_VERSION
  readonly key: string
  readonly source: ApiSource
  readonly tokens: readonly ApiToken[]
}

/** Derive the exact navigation status shown for a complete Spec. */
export function catalogSpecMetrics(spec: ViewerSpecificationProjection): CatalogSpecMetrics {
  const validationErrors = viewerSpecificationDiagnostics(spec).length
  const verificationErrors =
    spec.verification?.rules
      .filter((rule) => rule.status === 'fail' || rule.status === 'error')
      .reduce((count, rule) => count + Math.max(1, rule.diagnostics.length), 0) ?? 0
  return {
    errors: validationErrors + verificationErrors,
    open: 0,
    status: validationErrors
      ? 'error'
      : (spec.verification?.status ??
        (spec.modules.some((module) => module.contract) ? 'pending' : 'ok')),
  }
}

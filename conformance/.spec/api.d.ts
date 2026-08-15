import type {
  AnalysisQuery,
  AnalysisSnapshotSet,
  Completeness,
  FactId,
  ProjectUniverseId,
  SourceSpan,
} from '../../analysis/.spec/api.js'
import type {
  SpecificationSnapshot,
  SpecificationSnapshotId,
} from '../../specification/.spec/api.js'

export type QualificationSnapshotId = `qualification:${string}`
export type ConformanceStatus = 'pass' | 'fail' | 'indeterminate' | 'error'

export interface ConformanceDiagnostic {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly message: string
  readonly profile: string
  readonly rule: string
  readonly subject?: string
  readonly specificationPointer?: string
  readonly evidence: readonly SourceSpan[]
  readonly inputs: readonly FactId[]
  readonly expected?: unknown
  readonly actual?: unknown
  readonly hint?: string
}

export interface ConformanceRuleResult {
  readonly rule: string
  readonly status: ConformanceStatus
  readonly diagnostics: readonly ConformanceDiagnostic[]
  readonly coverage: ConformanceCoverage
}

export interface ConformanceCoverage {
  readonly forward: { readonly matched: number; readonly total: number }
  readonly inverse: { readonly matched: number; readonly total: number }
}

export interface ConformanceCapabilityRequirement {
  readonly capability: string
  readonly universes?: readonly ProjectUniverseId[]
  readonly scope?: 'universe' | 'specification-module'
  readonly minimumCompleteness?: 'complete' | 'partial'
  readonly acceptedPartialReasonCodes?: readonly string[]
}

export interface ConformanceProfileManifest {
  readonly id: string
  readonly version: string
  readonly dependsOn: readonly string[]
  readonly requiresCapabilities: readonly ConformanceCapabilityRequirement[]
  readonly rules: readonly string[]
}

export interface ConformanceProfileContext {
  readonly specification: SpecificationSnapshot
  readonly analysis: AnalysisSnapshotSet
  readonly queries: ReadonlyMap<ProjectUniverseId, AnalysisQuery>
  readonly dependencyResults: ReadonlyMap<string, QualificationProfileResult>
  readonly signal?: AbortSignal
}

export interface ConformanceProfile {
  readonly manifest: ConformanceProfileManifest
  evaluate(context: ConformanceProfileContext): Promise<readonly ConformanceRuleResult[]>
}

export interface QualificationProfileResult {
  readonly id: string
  readonly version: string
  readonly status: ConformanceStatus
  readonly rules: readonly ConformanceRuleResult[]
  readonly coverage: ConformanceCoverage
  readonly evidenceCompleteness: readonly {
    readonly universe: ProjectUniverseId
    readonly capability: string
    readonly completeness: Completeness
    readonly minimumCompleteness: 'complete' | 'partial'
    readonly acceptedPartialReasonCodes?: readonly string[]
  }[]
}

export type QualificationScope =
  | { readonly kind: 'full'; readonly authority: 'full-ci' }
  | {
      readonly kind: 'focused'
      readonly authority: 'advisory'
      readonly requestedProfiles: readonly string[]
      readonly includedProfiles: readonly string[]
      readonly supportProfiles: readonly string[]
    }

export interface QualificationSnapshot {
  readonly format: 'astrale.typespec.qualification'
  readonly version: 2
  readonly id: QualificationSnapshotId
  readonly specification: {
    readonly id: SpecificationSnapshotId
    readonly revision: string
    readonly source: string
  }
  readonly analysis: {
    readonly id: AnalysisSnapshotSet['id']
    readonly universes: readonly ProjectUniverseId[]
  }
  readonly scope: QualificationScope
  readonly status: ConformanceStatus
  readonly profiles: readonly QualificationProfileResult[]
}

export interface QualifySpecificationOptions {
  readonly specification: SpecificationSnapshot
  readonly analysis: AnalysisSnapshotSet
  readonly profiles: readonly ConformanceProfile[]
  readonly requestedProfiles?: readonly string[]
  readonly signal?: AbortSignal
}

export interface QualifySpecificationsOptions {
  readonly specifications: readonly SpecificationSnapshot[]
  readonly analysis: AnalysisSnapshotSet
  readonly profiles: readonly ConformanceProfile[]
  readonly requestedProfiles?: readonly string[]
  readonly signal?: AbortSignal
}

export function qualifySpecification(options: QualifySpecificationOptions): Promise<QualificationSnapshot>
export function qualifySpecifications(
  options: QualifySpecificationsOptions,
): Promise<readonly QualificationSnapshot[]>

export const SPECIFICATION_VALIDITY_PROFILE_ID: 'contract.specification.validity'
export const MODULE_STRUCTURE_PROFILE_ID: 'contract.module.structure'
export const MODULE_SURFACE_PROFILE_ID: 'contract.module.surface'
export const MODULE_DEPENDENCIES_PROFILE_ID: 'contract.module.dependencies'
export const MODULE_LAYOUT_PROFILE_ID: 'contract.module.layout'
export const MODULE_TEST_EVIDENCE_PROFILE_ID: 'contract.module.test-evidence'
export const MODULE_SCHEMA_PROFILE_ID: 'contract.module.schema-catalog'

export function createSpecificationValidityConformanceProfile(): ConformanceProfile

/** Establish one unambiguous implementation target. */
export function createModuleStructureConformanceProfile(): ConformanceProfile

/** Compare authored API meaning with complete portable TypeScript module-surface facts. */
export function createModuleSurfaceConformanceProfile(): ConformanceProfile

/** Prove package intent and every observed outbound dependency. */
export function createModuleDependenciesConformanceProfile(): ConformanceProfile

export interface ModuleLayoutConformanceOptions {
  readonly requireComplete?: boolean
  readonly requireExact?: boolean
}

export function createModuleLayoutConformanceProfile(
  options?: ModuleLayoutConformanceOptions,
): ConformanceProfile

export function createModuleTestEvidenceConformanceProfile(): ConformanceProfile

export function createModuleSchemaConformanceProfile(): ConformanceProfile

/** Install compiler-backed module profiles used independently of TypeSpec repository observations. */
export function createModuleConformanceProfiles(): readonly ConformanceProfile[]

/** Install the complete TypeSpec application profile DAG. */
export function createTypeSpecConformanceProfiles(
  options?: ModuleLayoutConformanceOptions,
): readonly ConformanceProfile[]

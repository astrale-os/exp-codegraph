import type { Completeness, SourceSpan } from '../../facts/.spec/api.js'
import type { AnalysisGeneration, FactTransaction } from '../../generation/.spec/api.js'
import type { ProducerIdentity } from '../../generation/.spec/api.js'
import type {
  AnalysisId,
  OccurrenceId,
  PassId,
  ProjectUniverseId,
  SourceId,
  SourceRevisionId,
  SymbolId,
} from '../../identity/.spec/api.js'
import type { PortablePass } from '../../pass/.spec/api.js'
import type {
  NativeAnalysisSessionFactory,
  NativeProjectDescriptor,
  NativeSourceChange,
} from '../../protocol/.spec/api.js'
import type { AnalysisStore } from '../../query/.spec/api.js'
import type { AnalysisTelemetrySink } from '../../profiling/.spec/api.js'
import type { FunctionBodyIR } from '../body/.spec/api.js'
import type {
  ObservationIssue,
  ObservedDeclaration,
  ObservedExport,
  SourceLocation,
} from '../surface/.spec/api.js'
import type { ValueResult } from '../value/.spec/api.js'

export const TYPESCRIPT_MODULE_FACT_NAMESPACE: 'astrale.typescript.module'
/** Declaration support shares the module capability namespace and is distinguished by fact kind. */
export const TYPESCRIPT_DECLARATION_FACT_NAMESPACE: 'astrale.typescript.module'
export const TYPESCRIPT_DECLARATION_FACT_KIND: 'declaration'

export interface TypeScriptModuleTarget {
  readonly id: string
  readonly name: string
  readonly project: string
  readonly root: string
  readonly entrypoint: string
  readonly facades: readonly string[]
  readonly aliases: readonly string[]
  readonly internals: readonly string[]
}

/**
 * One independently attributable reason that a logical module relationship exists.
 * Ordering is canonical and never conveys compiler traversal priority.
 */
export interface TypeScriptDependencyOccurrence {
  readonly id: OccurrenceId
  readonly typeOnly: boolean
  readonly specifier: string
  readonly deep: boolean
  readonly location: SourceLocation
  /** Canonical public declaration when the evidence comes from exported type closure. */
  readonly declaration?: string
  /** Deterministic public-declaration path from the module export to this closure target. */
  readonly publicPath?: readonly string[]
}

/**
 * One logical dependency between exact source and target files. Its identity excludes
 * occurrence order and locations; all contributing syntax and complete checker-reachable
 * public-type-closure evidence is retained.
 */
export interface TypeScriptDependencyFact {
  readonly id: AnalysisId<'typescript-dependency'>
  readonly sourceModule: string
  readonly targetModule: string
  readonly kind: 'api' | 'runtime' | 'type' | 'side-effect' | 'dynamic'
  readonly sourceFile: string
  readonly targetFile: string
  readonly occurrences: readonly TypeScriptDependencyOccurrence[]
}

export function typeScriptDependencyIdentity(
  input: Pick<
    TypeScriptDependencyFact,
    'sourceModule' | 'targetModule' | 'kind' | 'sourceFile' | 'targetFile'
  >,
): TypeScriptDependencyFact['id']

export function typeScriptDependencyOccurrenceIdentity(
  dependency: TypeScriptDependencyFact['id'],
  input: Omit<TypeScriptDependencyOccurrence, 'id'>,
): OccurrenceId

export interface TypeScriptModuleFact {
  readonly target: TypeScriptModuleTarget
  /** Canonical source-semantic surface; checker-reduced views are separate derived capabilities. */
  readonly exports: readonly ObservedExport[]
  readonly declarations: readonly ObservedDeclaration[]
  readonly dependencies: readonly TypeScriptDependencyFact[]
  readonly inboundDependencies: readonly TypeScriptDependencyFact[]
  readonly declaredPackages: readonly string[]
  readonly developmentPackages: readonly string[]
  readonly workspacePackages: readonly string[]
  /** Canonically ordered codes with traversal-independent representative provenance. */
  readonly errorCodes: readonly {
    readonly code: string
    readonly location: SourceLocation
  }[]
  readonly files: readonly string[]
  /** Flattened, attributable issue stream with exact native location and declaration joins. */
  readonly issues: readonly ObservationIssue[]
}

export interface TypeScriptProjectFact {
  readonly universe: ProjectUniverseId
  readonly configurationFiles: readonly string[]
  readonly projectReferences: readonly string[]
}

export interface TypeScriptDiagnosticFact {
  readonly code: number
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly file?: string
  readonly span?: SourceSpan
}

export interface TypeScriptSourceFact {
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly textDigest: string
  readonly logicalPath: string
  readonly declaration: boolean
  readonly projectOwned: boolean
}

export interface TypeScriptSymbolFact {
  readonly symbol: SymbolId
  readonly name: string
  readonly declarations: readonly SourceSpan[]
  readonly canonical?: SymbolId
  readonly generationScoped: boolean
}

export interface TypeScriptOccurrenceFact {
  readonly occurrence: OccurrenceId
  readonly kind: 'import' | 'export' | 'access' | 'construction' | 'render' | 'call' | 'other'
  readonly span: SourceSpan
  readonly target?: SymbolId
}

export interface TypeScriptBodyFacts {
  readonly body: FunctionBodyIR
  readonly values: Readonly<Record<string, ValueResult<unknown>>>
  readonly completeness: Completeness
}

export interface TypeScriptRefreshResult {
  readonly generation: AnalysisGeneration
  readonly transaction?: FactTransaction
  readonly changedSources: readonly SourceId[]
  /** Exact changed module subjects; absent after a full or uncertain refresh. */
  readonly changedModules?: readonly string[]
  readonly moduleRouting?: TypeScriptModuleRouting
  readonly invalidatedPasses: readonly PassId[]
  readonly diagnostics: readonly string[]
  readonly durationMs: number
}

export interface TypeScriptModuleRoutingEntry {
  readonly module: string
  readonly files: readonly string[]
  readonly dependencies: readonly string[]
}

export interface TypeScriptModuleRouting {
  readonly complete: boolean
  readonly modules: readonly TypeScriptModuleRoutingEntry[]
}

export interface TypeScriptAnalysisService {
  /** Compiler-derived current universe; undefined until the first successful refresh. */
  readonly universe: ProjectUniverseId | undefined
  dispose(): Promise<void>
  refresh(options?: {
    readonly changed?: readonly string[]
    readonly changes?: readonly NativeSourceChange[]
    readonly invalidate?: boolean
    readonly signal?: AbortSignal
  }): Promise<TypeScriptRefreshResult>
}

export interface TypeScriptAnalysisServiceOptions {
  readonly project: NativeProjectDescriptor
  readonly sessions: NativeAnalysisSessionFactory
  readonly store: AnalysisStore
  /** Previously materialized universe adopted by a newly opened compiler process. */
  readonly universe?: ProjectUniverseId
  readonly telemetry?: AnalysisTelemetrySink
}

export interface TypeScriptAnalysisPipelineOptions {
  readonly project: NativeProjectDescriptor
  readonly sessions: NativeAnalysisSessionFactory
  readonly store: AnalysisStore
  readonly universe?: ProjectUniverseId
  readonly passes: readonly PortablePass[]
  readonly requestedCapabilities: readonly string[]
  readonly producer: ProducerIdentity
}

export function createTypeScriptAnalysisService(
  options: TypeScriptAnalysisServiceOptions,
): Promise<TypeScriptAnalysisService>

export function createTypeScriptAnalysisPipeline(
  options: TypeScriptAnalysisPipelineOptions,
): Promise<TypeScriptAnalysisService>

export { validateFunctionBodyIR } from '../body/.spec/api.js'
export * from '../distribution/.spec/api.js'
export * from '../facts/.spec/api.js'
export type { FunctionBodyIR, ResolvedCall } from '../body/.spec/api.js'
export type { ValueResult } from '../value/.spec/api.js'
export type {
  ObservationIssue,
  ObservedCallable,
  ObservedCallableValueFacet,
  ObservedDeclaration,
  ObservedDeclarationFacets,
  ObservedDeclarationKind,
  ObservedExport,
  ObservedMember,
  ObservedObjectValueFacet,
  ObservedParameter,
  ObservedSurface,
  ObservedType,
  ObservedTypeFacet,
  ObservedTypeParameter,
  SourceLocation,
} from '../surface/.spec/api.js'

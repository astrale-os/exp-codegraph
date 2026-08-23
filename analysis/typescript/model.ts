import type { Completeness, SourceSpan } from '../facts/index.ts'
import type { AnalysisGeneration, FactTransaction, ProducerIdentity } from '../generation/index.ts'
import type {
  AnalysisId,
  OccurrenceId,
  PassId,
  ProjectUniverseId,
  SourceId,
  SourceRevisionId,
  SymbolId,
} from '../identity/index.ts'
import type { PortablePass } from '../pass/index.ts'
import type {
  NativeAnalysisSessionFactory,
  NativeModuleBoundary,
  NativeProjectDescriptor,
  NativeSourceChange,
} from '../protocol/index.ts'
import type { AnalysisStore } from '../query/index.ts'
import type { AnalysisTelemetrySink } from '../profiling/index.ts'
import type { FunctionBodyIR } from './body/index.ts'
import type {
  ObservationIssue,
  ObservedDeclaration,
  ObservedExport,
  SourceLocation,
} from './surface/index.ts'
import type { ValueResult } from './value/model.ts'

export const TYPESCRIPT_MODULE_FACT_NAMESPACE = 'astrale.typescript.module' as const
export const TYPESCRIPT_DECLARATION_FACT_NAMESPACE = TYPESCRIPT_MODULE_FACT_NAMESPACE
export const TYPESCRIPT_DECLARATION_FACT_KIND = 'declaration' as const

export type TypeScriptModuleTarget = NativeModuleBoundary

export interface TypeScriptDependencyOccurrence {
  readonly id: OccurrenceId
  readonly typeOnly: boolean
  readonly specifier: string
  readonly deep: boolean
  readonly location: SourceLocation
  readonly declaration?: string
  /** One deterministic public-declaration path from the module export to this closure target. */
  readonly publicPath?: readonly string[]
}

export interface TypeScriptDependencyFact {
  readonly id: AnalysisId<'typescript-dependency'>
  readonly sourceModule: string
  readonly targetModule: string
  readonly kind: 'api' | 'runtime' | 'type' | 'side-effect' | 'dynamic'
  readonly sourceFile: string
  readonly targetFile: string
  readonly occurrences: readonly TypeScriptDependencyOccurrence[]
}

export interface TypeScriptErrorCodeFact {
  readonly code: string
  readonly location: SourceLocation
}

/** Complete portable public/module observation emitted by a compiler-near pass. */
export interface TypeScriptModuleFact {
  readonly target: TypeScriptModuleTarget
  readonly exports: readonly ObservedExport[]
  readonly declarations: readonly ObservedDeclaration[]
  readonly dependencies: readonly TypeScriptDependencyFact[]
  readonly inboundDependencies: readonly TypeScriptDependencyFact[]
  readonly declaredPackages: readonly string[]
  readonly developmentPackages: readonly string[]
  readonly workspacePackages: readonly string[]
  readonly errorCodes: readonly TypeScriptErrorCodeFact[]
  readonly files: readonly string[]
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
  /** Exact logical module subjects whose normalized fact changed; absent after a full/uncertain refresh. */
  readonly changedModules?: readonly string[]
  /** Compact exact routing evidence used to avoid retaining unrelated compiler processes. */
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

import type { AnalysisStore } from '../query/.spec/api.js'

export type {
  AnalysisId,
  AnalysisGenerationId,
  FactId,
  FactShardDigest,
  FactShardKey,
  OccurrenceId,
  PassId,
  PolicyId,
  ProducerId,
  ProjectUniverseId,
  RepositoryId,
  SnapshotSetId,
  SourceId,
  SourceManifestId,
  SourceRevisionId,
  SymbolId,
} from '../identity/.spec/api.js'
export { admitAnalysisId, deriveAnalysisId, portablePath } from '../identity/.spec/api.js'
export type {
  AnalysisFailure,
  AnalysisLimit,
  Completeness,
  Fact,
  FactProvenance,
  FactShard,
  FactShardReference,
  SourceSpan,
} from '../facts/.spec/api.js'
export { factShardDigest, shardReference, validateFactShard } from '../facts/.spec/api.js'
export type {
  AnalysisGeneration,
  FactTransaction,
  ProducerIdentity,
  TransactionFailureCode,
} from '../generation/.spec/api.js'
export {
  TransactionError,
  generationIdentity,
  validateFactTransaction,
} from '../generation/.spec/api.js'
export type {
  FactSchemaReference,
  PassManifest,
  PassOutput,
  PassPlan,
  PassRuntime,
  PassScope,
  PortablePass,
  PortablePassContext,
} from '../pass/.spec/api.js'
export { PassPlanError, planPasses } from '../pass/.spec/api.js'
export type {
  AnalysisPolicy,
  AnalysisPolicyContext,
  PolicyDiagnostic,
  PolicyEvaluation,
  PolicyManifest,
  PolicyRuleResult,
  PolicyRuleStatus,
  PolicyRunOptions,
} from '../policy/.spec/api.js'
export { runAnalysisPolicies } from '../policy/.spec/api.js'
export type {
  AnalysisQuery,
  AnalysisSnapshotSet,
  AnalysisStore,
  CapabilityStatus,
  FactFilter,
  FactPage,
  PageRequest,
} from '../query/.spec/api.js'
export { createMemoryAnalysisStore } from '../memory/.spec/api.js'
export type {
  SourceTextExpectation,
  SourceTextReader,
  VerifiedSourceText,
} from '../source/.spec/api.js'
export { createNodeSourceTextReader, readVerifiedSourceText } from '../source/.spec/api.js'
export type {
  NativeAnalysisRequest,
  NativeAnalysisResponse,
  NativeAnalysisSession,
  NativeAnalysisSessionFactory,
  NativeModuleBoundary,
  NativeProjectDescriptor,
  ProcessNativeAnalysisSessionFactoryOptions,
} from '../protocol/.spec/api.js'
export {
  NATIVE_ANALYSIS_PROTOCOL_VERSION,
  createProcessNativeAnalysisSessionFactory,
} from '../protocol/.spec/api.js'

export type PersistenceRequirement = 'advisory' | 'required'

export interface AnalysisStoreSelectionOptions {
  readonly persistence: PersistenceRequirement
  readonly openDurable?: () => Promise<AnalysisStore>
  readonly memory?: { readonly maximumRetainedGenerations?: number }
}

export interface AnalysisStoreSelection {
  readonly store: AnalysisStore
  readonly backend: 'durable' | 'memory'
  readonly persistence: PersistenceRequirement
  readonly fallback?: {
    readonly code: 'DURABLE_STORE_UNAVAILABLE'
    readonly message: string
    readonly cause: unknown
  }
}

export class AnalysisStoreUnavailableError extends Error {
  readonly code: 'DURABLE_STORE_UNAVAILABLE'
}

export function selectAnalysisStore(
  options: AnalysisStoreSelectionOptions,
): Promise<AnalysisStoreSelection>

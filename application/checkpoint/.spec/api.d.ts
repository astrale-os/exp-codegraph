import type { AnalysisGenerationId, ProjectUniverseId } from '../../../analysis/identity/.spec/api.js'
import type { FileWorkspaceCheckpointStore } from '../../../workspace/checkpoint/.spec/api.js'
import type { RepositoryStatisticsReport } from '../../../repository/statistics/.spec/api.js'
import type { RepositoryInventory } from '../../../repository/.spec/api.js'
import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'
import type {
  TypeSpecApplicationCapability,
  TypeSpecApplicationSnapshot,
} from '../../.spec/api.js'

export interface ApplicationCheckpointExpectation {
  readonly repository: `repository:${string}`
  readonly inventory: `source-manifest:${string}`
  readonly corpus: string
  readonly request: string
  readonly sourceProof?: string
  readonly manifestSha256?: string
  readonly projection?: {
    readonly requested: readonly string[]
    readonly includeDependents: boolean
    readonly capabilities: readonly TypeSpecApplicationCapability[]
  }
  readonly signal?: AbortSignal
}

export interface ApplicationCheckpointReference {
  readonly scope: string
  readonly manifestSha256: string
}

export interface ApplicationCheckpointManifestExpectation {
  readonly repository: `repository:${string}`
  readonly inventory: `source-manifest:${string}`
  readonly corpus: string
  readonly sourceProof: string
}

export type ApplicationCheckpointManifestAdmission =
  | { readonly ok: true; readonly reference: ApplicationCheckpointReference }
  | { readonly ok: false; readonly reason: 'missing' | 'incompatible' | 'unavailable' }

export interface ApplicationCheckpointContent {
  readonly snapshot: TypeSpecApplicationSnapshot
  readonly complete: boolean
  readonly specifications: readonly SpecificationSnapshot[]
  readonly inventory: RepositoryInventory
  readonly statistics?: RepositoryStatisticsReport
}

export interface ApplicationCheckpointLoadedContent
  extends Omit<ApplicationCheckpointContent, 'snapshot'> {
  readonly snapshot?: TypeSpecApplicationSnapshot
  readonly complete: boolean
}

export type ApplicationCheckpointLoadResult =
  | {
      readonly ok: true
      readonly exact: boolean
      readonly request: boolean
      readonly work: {
        readonly projection: 'complete' | 'request-closure'
        readonly artifacts: number
        readonly decodedBytes: number
        readonly specifications: number
        readonly apiPayloads: number
      }
      readonly content: ApplicationCheckpointLoadedContent
    }
  | { readonly ok: false; readonly reason: 'missing' | 'incompatible' | 'corrupt' | 'unavailable' }

export interface ApplicationCheckpoint {
  readonly publication?: 'enabled' | 'disabled'
  load(expectation: ApplicationCheckpointExpectation): Promise<ApplicationCheckpointLoadResult>
  publish(expectation: ApplicationCheckpointExpectation, content: ApplicationCheckpointContent): Promise<void>
}

export function createApplicationCheckpoint(options: {
  readonly store: FileWorkspaceCheckpointStore
  readonly producerFingerprint: string
}): ApplicationCheckpoint

export function applicationCheckpointCorpus(exclude: readonly string[]): string

export function applicationCheckpointScope(
  expectation: Pick<ApplicationCheckpointExpectation, 'corpus' | 'sourceProof'>,
): string

export function admitApplicationCheckpointManifest(
  options: {
    readonly store: FileWorkspaceCheckpointStore
    readonly producerFingerprint: string
  },
  expectation: ApplicationCheckpointManifestExpectation,
): Promise<ApplicationCheckpointManifestAdmission>

export function checkpointGenerations(
  snapshot: TypeSpecApplicationSnapshot,
): ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>

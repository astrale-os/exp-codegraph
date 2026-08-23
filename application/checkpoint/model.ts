import type { RepositoryId, SourceManifestId } from '../../analysis/index.ts'
import type { RepositoryInventory, RepositoryStatisticsReport } from '../../repository/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'
import type { TypeSpecApplicationCapability, TypeSpecApplicationSnapshot } from '../model.ts'

export interface ApplicationCheckpointExpectation {
  readonly repository: RepositoryId
  readonly inventory: SourceManifestId
  /** Corpus-affecting discovery scope, independent of selection and qualification policy. */
  readonly corpus: string
  readonly request: string
  /** Portable checkpoint manifests are additionally bound to an admitted source proof. */
  readonly sourceProof?: string
  /** Optional root-manifest commitment supplied by a portable semantic pack. */
  readonly manifestSha256?: string
  /** Optional focused projection over the manifest-owned corpus index. */
  readonly projection?: {
    /** Portable repository-relative selection targets, normalized by the application owner. */
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
  readonly repository: RepositoryId
  readonly inventory: SourceManifestId
  readonly corpus: string
  readonly sourceProof: string
}

export type ApplicationCheckpointManifestAdmission =
  | { readonly ok: true; readonly reference: ApplicationCheckpointReference }
  | { readonly ok: false; readonly reason: 'missing' | 'incompatible' | 'unavailable' }

export interface ApplicationCheckpointContent {
  readonly snapshot: TypeSpecApplicationSnapshot
  /** Complete discovered corpus; a focused snapshot may contain only a subset. */
  readonly specifications: readonly SpecificationSnapshot[]
  readonly inventory: RepositoryInventory
  readonly statistics?: RepositoryStatisticsReport
}

export interface ApplicationCheckpointLoadedContent
  extends Omit<ApplicationCheckpointContent, 'snapshot'> {
  /** Exact loads retain the prior snapshot; projected corpus loads deliberately do not hydrate it. */
  readonly snapshot?: TypeSpecApplicationSnapshot
  /** False when specifications contain only the exact requested/support closure. */
  readonly complete: boolean
}

export type ApplicationCheckpointLoadResult =
  | {
      readonly ok: true
      /** Exact requests can publish immediately; corpus hits must refresh derived products. */
      readonly exact: boolean
      /** Same semantic request may reuse unchanged specification-local derived products. */
      readonly request: boolean
      /** Loaded representation should be republished through the observable lifecycle writer. */
      readonly migration: boolean
      readonly work: {
        readonly projection: 'complete' | 'request-closure'
        readonly artifacts: number
        readonly decodedBytes: number
        readonly specifications: number
        readonly apiPayloads: number
      }
      readonly content: ApplicationCheckpointLoadedContent
    }
  | {
      readonly ok: false
      readonly reason: 'missing' | 'incompatible' | 'corrupt' | 'unavailable'
    }

/** Application-owned codec over a generic advisory workspace checkpoint store. */
export interface ApplicationCheckpoint {
  /** Disabled readers may restore supplied evidence but never claim a publication. */
  readonly publication?: 'enabled' | 'disabled'
  load(expectation: ApplicationCheckpointExpectation): Promise<ApplicationCheckpointLoadResult>
  publish(
    expectation: ApplicationCheckpointExpectation,
    content: ApplicationCheckpointContent,
  ): Promise<void>
}

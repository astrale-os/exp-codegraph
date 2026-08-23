/** JSON values are deliberately narrower than `unknown`: executable values never enter a file. */
export type JsonValue =
  | null
  | boolean
  | string
  | number
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export interface WorkspaceCheckpointArtifactDescriptor {
  readonly key: string
  readonly digest: string
  readonly bytes: number
}

/** The on-disk manifest shape. Additional JSON fields are retained for generic callers. */
export interface WorkspaceCheckpointManifest {
  readonly format: string
  readonly version: number
  readonly scope: string
  readonly payload: JsonValue
  readonly artifacts: readonly WorkspaceCheckpointArtifactDescriptor[]
  readonly producerFingerprint?: string
  readonly producer?: JsonValue
  readonly [key: string]: unknown
}

/** Metadata supplied to `publish`; scope and artifact descriptors are owned by the store. */
export interface WorkspaceCheckpointManifestInput {
  readonly format: string
  readonly version: number
  readonly payload: unknown
  readonly scope?: string
  readonly artifacts?: readonly WorkspaceCheckpointArtifactDescriptor[]
  readonly producerFingerprint?: string
  readonly producer?: JsonValue
  readonly [key: string]: unknown
}

export interface WorkspaceCheckpointArtifactInput {
  readonly key: string
  readonly bytes: Uint8Array
}

export type WorkspaceCheckpointArtifacts =
  | ReadonlyMap<string, Uint8Array>
  | Readonly<Record<string, Uint8Array>>
  | readonly WorkspaceCheckpointArtifactInput[]
  | readonly (readonly [string, Uint8Array])[]

export interface WorkspaceCheckpointPublishInput {
  readonly manifest: WorkspaceCheckpointManifestInput
  readonly artifacts: WorkspaceCheckpointArtifacts
  /** Optional per-operation cancellation. A third publish argument is also supported. */
  readonly signal?: AbortSignal
}

export interface WorkspaceCheckpointOperationOptions {
  readonly signal?: AbortSignal
}

export interface WorkspaceCheckpointLoadOptions extends WorkspaceCheckpointOperationOptions {
  /** Omit for eager compatibility, pass an empty list to admit only the manifest. */
  readonly artifactKeys?: readonly string[]
}

export interface FileWorkspaceCheckpointStoreOptions {
  readonly directory: string
  readonly maxManifestBytes?: number
  readonly maxArtifactBytes?: number
  readonly maxArtifacts?: number
  readonly maxTotalBytes?: number
  /** Maximum independently named manifests retained by this store. */
  readonly maximumScopes?: number
  readonly signal?: AbortSignal
}

export type WorkspaceCheckpointMissReason =
  | 'manifest-missing'
  | 'manifest-unreadable'
  | 'manifest-too-large'
  | 'manifest-invalid'
  | 'artifact-missing'
  | 'artifact-unreadable'
  | 'artifact-too-large'
  | 'artifact-corrupt'
  | 'artifacts-too-large'

export interface WorkspaceCheckpointMiss {
  readonly ok: false
  readonly reason: WorkspaceCheckpointMissReason
}

export interface WorkspaceCheckpointHit {
  readonly ok: true
  readonly manifest: WorkspaceCheckpointManifest
  readonly artifacts: ReadonlyMap<string, Uint8Array>
}

export type WorkspaceCheckpointLoadResult = WorkspaceCheckpointHit | WorkspaceCheckpointMiss

export interface FileWorkspaceCheckpointStore {
  load(
    scope: string,
    options?: WorkspaceCheckpointLoadOptions,
  ): Promise<WorkspaceCheckpointLoadResult>
  publish(
    scope: string,
    input: WorkspaceCheckpointPublishInput,
    options?: WorkspaceCheckpointOperationOptions,
  ): Promise<void>
  remove(scope: string, options?: WorkspaceCheckpointOperationOptions): Promise<void>
  dispose(): Promise<void>
}

export const DEFAULT_WORKSPACE_CHECKPOINT_LIMITS = Object.freeze({
  maxManifestBytes: 1 * 1024 * 1024,
  maxArtifactBytes: 64 * 1024 * 1024,
  maxArtifacts: 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maximumScopes: 32,
})

export interface NormalizedLimits {
  readonly maxManifestBytes: number
  readonly maxArtifactBytes: number
  readonly maxArtifacts: number
  readonly maxTotalBytes: number
  readonly maximumScopes: number
}

export interface PreparedArtifact {
  readonly key: string
  readonly digest: string
  readonly bytes: number
  readonly data: Uint8Array
}

export interface PreparedPublication {
  readonly artifacts: readonly PreparedArtifact[]
  readonly bytes: Buffer
}

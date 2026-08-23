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

export interface WorkspaceCheckpointManifest {
  readonly format: string
  readonly version: number
  readonly scope: string
  readonly payload: JsonValue
  readonly artifacts: readonly WorkspaceCheckpointArtifactDescriptor[]
  readonly producerFingerprint?: string
  readonly producer?: JsonValue
}

export interface WorkspaceCheckpointManifestInput {
  readonly format: string
  readonly version: number
  readonly payload: unknown
  readonly scope?: string
  readonly artifacts?: readonly WorkspaceCheckpointArtifactDescriptor[]
  readonly producerFingerprint?: string
  readonly producer?: JsonValue
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
  readonly signal?: AbortSignal
}

export const WORKSPACE_CHECKPOINT_JSON_ENCODING: 'br-json/1'

export interface WorkspaceCheckpointJsonOptions {
  readonly maximumDecodedBytes: number
}

export interface WorkspaceCheckpointJsonArtifact<Value = unknown> {
  readonly value: Value
  readonly decodedBytes: number
}

export function encodeWorkspaceCheckpointJson(
  value: unknown,
  options: WorkspaceCheckpointJsonOptions,
): WorkspaceCheckpointJsonArtifact<Uint8Array>

export function decodeWorkspaceCheckpointJson(
  bytes: Uint8Array,
  options: WorkspaceCheckpointJsonOptions,
): WorkspaceCheckpointJsonArtifact

export interface FileWorkspaceCheckpointStoreOptions {
  readonly directory: string
  readonly maxManifestBytes?: number
  readonly maxArtifactBytes?: number
  readonly maxArtifacts?: number
  readonly maxTotalBytes?: number
  readonly maximumScopes?: number
  readonly signal?: AbortSignal
}

export interface WorkspaceCheckpointOperationOptions {
  readonly signal?: AbortSignal
}

export interface WorkspaceCheckpointLoadOptions extends WorkspaceCheckpointOperationOptions {
  readonly artifactKeys?: readonly string[]
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

export interface WorkspaceCheckpointHit {
  readonly ok: true
  readonly manifest: WorkspaceCheckpointManifest
  readonly artifacts: ReadonlyMap<string, Uint8Array>
}

export interface WorkspaceCheckpointMiss {
  readonly ok: false
  readonly reason: WorkspaceCheckpointMissReason
}

export type WorkspaceCheckpointLoadResult = WorkspaceCheckpointHit | WorkspaceCheckpointMiss

export interface FileWorkspaceCheckpointStore {
  load(scope: string, options?: WorkspaceCheckpointLoadOptions): Promise<WorkspaceCheckpointLoadResult>
  publish(
    scope: string,
    input: WorkspaceCheckpointPublishInput,
    options?: WorkspaceCheckpointOperationOptions,
  ): Promise<void>
  remove(scope: string, options?: WorkspaceCheckpointOperationOptions): Promise<void>
  dispose(): Promise<void>
}

export const DEFAULT_WORKSPACE_CHECKPOINT_LIMITS: Readonly<{
  maxManifestBytes: number
  maxArtifactBytes: number
  maxArtifacts: number
  maxTotalBytes: number
  maximumScopes: number
}>

export function createFileWorkspaceCheckpointStore(
  options: FileWorkspaceCheckpointStoreOptions,
): FileWorkspaceCheckpointStore

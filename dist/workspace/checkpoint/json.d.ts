export declare const WORKSPACE_CHECKPOINT_JSON_ENCODING: 'br-json/1';
export interface WorkspaceCheckpointJsonOptions {
    readonly maximumDecodedBytes: number;
}
export interface WorkspaceCheckpointJsonArtifact<Value = unknown> {
    readonly value: Value;
    readonly decodedBytes: number;
}
/** Deterministically encode one independently bounded JSON checkpoint artifact. */
export declare function encodeWorkspaceCheckpointJson(value: unknown, options: WorkspaceCheckpointJsonOptions): WorkspaceCheckpointJsonArtifact<Uint8Array>;
/** Decode one checkpoint artifact while bounding expansion before JSON parsing. */
export declare function decodeWorkspaceCheckpointJson(bytes: Uint8Array, options: WorkspaceCheckpointJsonOptions): WorkspaceCheckpointJsonArtifact;

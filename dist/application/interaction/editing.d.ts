/** Generation-pinned application source editing transport. */
export declare const SOURCE_EDIT_PROTOCOL: 'astrale.spec.editing.v2';
export declare const SOURCE_EDIT_ENDPOINT = "/__astrale/spec-source";
export declare const SOURCE_EDIT_HEADER = "x-astrale-spec-edit";
export interface SourceEditRequest {
    source: string;
    revision: string;
    text: string;
}
export interface SourceEditOptions {
    signal?: AbortSignal;
}
export interface SourceEditAdapter {
    save(request: SourceEditRequest, options?: SourceEditOptions): Promise<SourceEditResponse>;
}
export interface SourceEditHttpAdapterManifest {
    transport: 'http';
    protocol: typeof SOURCE_EDIT_PROTOCOL;
    endpoint: string;
}
export interface SourceSaved {
    status: 'saved';
    revision: string;
}
export interface SourceConflict {
    status: 'conflict';
    revision: string;
    text: string;
}
export interface SourceEditError {
    status: 'error';
    message: string;
}
export type SourceEditResponse = SourceSaved | SourceConflict | SourceEditError;
export declare class SourceEditAdapterError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}

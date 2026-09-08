/** Generation-pinned application specification reveal transport. */
export declare const SPEC_REVEAL_PROTOCOL: 'astrale.spec.reveal.v2';
export declare const SPEC_REVEAL_ENDPOINT = "/__astrale/spec-reveal";
export declare const SPEC_REVEAL_HEADER = "x-astrale-spec-reveal";
export interface SpecRevealRequest {
    source: string;
}
export interface SpecRevealOptions {
    signal?: AbortSignal;
}
export interface SpecRevealAdapter {
    reveal(request: SpecRevealRequest, options?: SpecRevealOptions): Promise<void>;
}
export interface SpecRevealHttpAdapterManifest {
    transport: 'http';
    protocol: typeof SPEC_REVEAL_PROTOCOL;
    endpoint: string;
}
export interface SpecRevealed extends SpecRevealRequest {
    protocol: typeof SPEC_REVEAL_PROTOCOL;
    status: 'revealed';
}
export type SpecRevealErrorCode = 'REQUEST_INVALID' | 'SNAPSHOT_CHANGED' | 'SOURCE_NOT_FOUND' | 'REVEAL_FAILED';
export interface SpecRevealRejected {
    protocol: typeof SPEC_REVEAL_PROTOCOL;
    status: 'rejected';
    code: SpecRevealErrorCode;
    message: string;
}
export type SpecRevealResponse = SpecRevealed | SpecRevealRejected;
export declare class SpecRevealAdapterError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}

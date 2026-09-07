export declare const MAX_FILE_BYTES: number;
export type ReplaceBoundedResult = {
    status: 'saved';
    revision: string;
} | {
    status: 'conflict';
    revision: string;
};
export declare function readBytesBounded(file: string, maximumBytes?: number): Promise<Buffer>;
export declare function readBounded(file: string, maximumBytes?: number): Promise<string>;
export declare function optionalDirectFile(file: string): Promise<boolean>;
export declare function sourceRevision(content: string | Uint8Array): string;
export declare function replaceBounded(file: string, text: string, expectedRevision: string): Promise<ReplaceBoundedResult>;

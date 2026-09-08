export interface BinaryCacheStore {
    load(): Promise<Buffer | undefined>;
    save(value: Uint8Array): Promise<void>;
    remove(): Promise<void>;
}
export interface BoundedFileCacheOptions {
    readonly directory: string;
    readonly key: string;
    readonly maxEntryBytes: number;
    readonly maxTotalBytes: number;
    readonly maxEntries: number;
}
/** Store one atomic cache value while bounding the entire shared cache directory. */
export declare function createBoundedFileCacheStore(options: BoundedFileCacheOptions): BinaryCacheStore;
export declare function defaultTypeSpecCacheDirectory(environment?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string;

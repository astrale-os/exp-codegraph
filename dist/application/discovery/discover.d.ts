export interface ApplicationDiscoveryOptions {
    /** Root-relative directory trees pruned before filesystem traversal. */
    readonly exclude?: readonly string[];
}
/** Resolve and validate the physical application root without making it part of portable identity. */
export declare function resolveApplicationRoot(input: string): Promise<string>;
/** Discover only convention-owned `.spec/api.d.ts` anchors in deterministic lexical order. */
export declare function discoverSpecificationDirectories(directory: string, options?: ApplicationDiscoveryOptions): Promise<string[]>;

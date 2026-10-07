export type ChangedSpecificationScope = {
    readonly kind: 'none';
    readonly files: readonly string[];
    readonly base: string;
} | {
    readonly kind: 'full';
    readonly files: readonly string[];
    readonly base: string;
    readonly triggers: readonly string[];
} | {
    readonly kind: 'selected';
    readonly files: readonly string[];
    readonly base: string;
    readonly targets: readonly string[];
};
/** Resolve committed and local Git changes into their nearest specification owners. */
export declare function changedSpecificationScope(root: string, requestedBase?: string): Promise<ChangedSpecificationScope>;
/** Re-express workspace-relative changed files against the catalog root; files outside it drop. */
export declare function catalogChangedFiles(root: string, files: readonly string[]): Promise<readonly string[]>;

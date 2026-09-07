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

/**
 * Identify a catalog source by its nearest owning package without replacing its
 * canonical catalog-file identity.
 */
export declare function workspacePackageCoordinate(catalogRoot: string, file: string): string | undefined;
/**
 * Map a declaration-only DefinitelyTyped provider to the package whose public
 * TypeScript surface it implements. File suffixes remain available for source
 * navigation while package-level conformance uses the authored dependency.
 */
export declare function canonicalTypeProviderCoordinate(coordinate: string): string;
/** Nearest package boundary containing a selected catalog, if one exists. */
export declare function nearestPackageRoot(directory: string): string | undefined;

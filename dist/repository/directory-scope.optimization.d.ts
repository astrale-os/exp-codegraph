/** Resolve the common literal recursive-directory glob forms without compiling a matcher. */
export declare function simpleDirectoryExclusion(path: string, normalizedPattern: string): boolean | undefined;
/** Match the same common recursive forms for a concrete repository file path. */
export declare function simpleRepositoryPathMatch(path: string, normalizedPattern: string): boolean | undefined;

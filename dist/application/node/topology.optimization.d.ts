/** Read independent directory levels concurrently while retaining one canonical path order. */
export declare function scanRepositoryDirectories(root: string, exclude: readonly string[], signal?: AbortSignal): Promise<readonly string[]>;

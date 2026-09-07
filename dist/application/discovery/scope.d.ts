/** Generated, dependency, and VCS trees excluded from one application-owned repository inventory. */
export declare const APPLICATION_REPOSITORY_EXCLUDES: readonly string[];
/** Exact normalized repository scope shared by application refresh and restart admission. */
export declare function applicationRepositoryExcludes(root: string, exclude: readonly string[]): readonly string[];

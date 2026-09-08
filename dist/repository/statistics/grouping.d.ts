import type { RepositoryStatisticsGrouping } from './model.ts';
export interface RepositoryPathOwner {
    /** Repository-relative directory owned by this group. `.` owns the repository root. */
    readonly root: string;
    readonly key: string;
    readonly label?: string;
}
/**
 * Build one deterministic, single-owner grouping from nested repository roots.
 * The deepest matching root wins, so a child module does not inflate its parent.
 */
export declare function createRepositoryPathOwnershipGrouping(id: string, owners: readonly RepositoryPathOwner[]): RepositoryStatisticsGrouping;

import type { RepositoryStatisticsOptions, RepositoryStatisticsReport } from './model.ts';
/** Options for refreshing a repository statistics report from a prior report. */
export interface RepositoryStatisticsRefreshOptions extends RepositoryStatisticsOptions {
    /** The report from the preceding inventory, when one is available. */
    readonly previous?: RepositoryStatisticsReport;
}
export interface RepositoryStatisticsRefreshWork {
    /** Repository-relative paths whose prior per-file metrics were reused. */
    readonly reusedFiles: readonly string[];
    /** Repository-relative paths whose per-file metrics were computed in this refresh. */
    readonly analyzedFiles: readonly string[];
    /** Repository-relative paths present in the prior report but absent from this inventory. */
    readonly removedFiles: readonly string[];
}
export interface RepositoryStatisticsRefreshResult {
    readonly report: RepositoryStatisticsReport;
    readonly work: RepositoryStatisticsRefreshWork;
}
/**
 * Refresh repository statistics while preserving the exact cold-analysis result.
 *
 * A prior file is reused only when its source and revision still identify the
 * current file, the current analyzer selection has the same identity/version,
 * and the prior per-file result was complete. Everything else is sent through
 * the cold file analyzer, including analyzer failures and unavailable reads.
 */
export declare function refreshRepositoryStatistics(options: RepositoryStatisticsRefreshOptions): Promise<RepositoryStatisticsRefreshResult>;

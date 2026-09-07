import type { RepositoryStatisticsOptions, RepositoryStatisticsReport } from './model.ts';
/** Analyze one immutable inventory without creating a compiler project or retaining source text. */
export declare function analyzeRepositoryStatistics(options: RepositoryStatisticsOptions): Promise<RepositoryStatisticsReport>;

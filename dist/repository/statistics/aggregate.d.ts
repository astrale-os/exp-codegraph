import type { Completeness } from '../../analysis/facts/index.ts';
import type { RepositoryFile } from '../model.ts';
import type { RepositoryFileStatistics, RepositoryStatisticsGrouping, RepositoryStatisticsGroup, RepositoryStatisticsSummary, SourceLineMetrics } from './model.ts';
export declare function summarizeRepositoryStatistics(files: readonly RepositoryFileStatistics[]): RepositoryStatisticsSummary;
export declare function aggregateRepositoryStatistics(files: readonly RepositoryFileStatistics[], inventoryFiles: readonly RepositoryFile[], groupings: readonly RepositoryStatisticsGrouping[]): readonly RepositoryStatisticsGroup[];
export declare function defaultRepositoryStatisticsGroupings(): readonly RepositoryStatisticsGrouping[];
export declare function mergeStatisticsCompleteness(values: readonly Completeness[]): Completeness;
export declare function sumSourceLines(values: readonly SourceLineMetrics[]): SourceLineMetrics;

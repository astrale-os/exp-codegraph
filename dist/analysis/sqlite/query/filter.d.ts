import type { FactFilter } from '../../query/index.ts';
export interface SQLiteFilter {
    readonly sql: string;
    readonly parameters: readonly string[];
}
/** Build only fixed SQL fragments; every caller value remains a bound parameter. */
export declare function buildSQLiteFactFilter(filter: FactFilter): SQLiteFilter;

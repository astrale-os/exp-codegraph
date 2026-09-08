export interface CatalogRebuildResult {
    readonly changed: boolean;
    readonly generation: number;
}
export interface RebuildScheduler {
    request(): Promise<CatalogRebuildResult>;
}
export interface SourceChangeFilter {
    changed(file: string): Promise<boolean>;
}
/** Coalesce event bursts and rebuild only after the latest edit has remained quiet. */
export declare function createRebuildScheduler(rebuild: () => Promise<CatalogRebuildResult>, debounceMs?: number): RebuildScheduler;
/** Suppress duplicate watcher notifications without interpreting source semantics. */
export declare function createSourceChangeFilter(capacity?: number): SourceChangeFilter;

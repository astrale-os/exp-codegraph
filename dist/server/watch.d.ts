import type { TypeSpecApplicationSnapshot } from '../application/index.ts';
export type WatchEvent = 'change' | 'add' | 'unlink';
export interface WatchScope {
    /** Implementation sources affect the catalog only while compiler analysis is active. */
    readonly compilerAnalysis?: boolean;
    /** Specification sources explicitly opted into live compiler verification. */
    readonly compilerSpecifications?: readonly string[];
}
/** Resolve changed paths to the deepest specification owners used by incremental presentation. */
export declare function affectedSpecificationSources(snapshot: TypeSpecApplicationSnapshot, root: string, files: readonly string[]): readonly string[];
/** Generated/local trees Vite can prune before they reach semantic change filtering. */
export declare const DEV_SERVER_WATCH_IGNORES: readonly ['**/.git/**', '**/.next/**', '**/.pnpm-store/**', '**/.turbo/**', '**/.wrangler/**', '**/coverage/**', '**/dist/**', '**/node_modules/**', '**/benchmark/artifacts/**', '**/benchmark/evidence/**', '**/benchmark/runs/**', '**/benchmarks/artifacts/**', '**/benchmarks/evidence/**', '**/benchmarks/runs/**', '**/evidence/artifacts/**', '**/evidence/runs/**', '**/qualification/artifacts/**', '**/qualification/evidence/**', '**/qualification/runs/**'];
/**
 * Conservative V2 invalidation boundary. Precise affected-pass planning belongs to analysis;
 * the watcher only rejects definitely irrelevant filesystem events.
 */
export declare function isWatchedSource(snapshot: TypeSpecApplicationSnapshot | undefined, root: string, file: string, event?: WatchEvent, scope?: WatchScope): boolean;

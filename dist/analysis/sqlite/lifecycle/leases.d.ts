import type { DatabaseSync } from 'node:sqlite';
import type { AnalysisGeneration } from '../../generation/index.ts';
export declare class SQLiteLeaseRegistry {
    #private;
    constructor(database: DatabaseSync, storeNamespace: string, timeoutMs: number);
    insert(generation: AnalysisGeneration): string;
    start(lease: string): void;
    release(lease: string): void;
    dispose(): void;
    private assertOpen;
}

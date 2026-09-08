import type { DatabaseSync } from 'node:sqlite';
import type { ProjectUniverseId } from '../../identity/index.ts';
export declare function collectSQLiteGenerations(database: DatabaseSync, storeNamespace: string, universe: ProjectUniverseId, maximumRetained: number): void;

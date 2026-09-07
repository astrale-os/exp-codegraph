import type { FactShard } from '../facts/index.ts';
import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts';
import type { AnalysisGenerationId, ProjectUniverseId, SourceManifestId } from '../identity/index.ts';
import type { AnalysisQuery, AnalysisSnapshotSet } from '../query/index.ts';
export interface MaterializedGeneration {
    readonly generation: AnalysisGeneration;
    readonly shards: ReadonlyMap<string, FactShard>;
}
export declare function materializeTransaction(current: MaterializedGeneration | undefined, transaction: FactTransaction): MaterializedGeneration;
export declare function serializeMaterialized(value: MaterializedGeneration): string;
export declare function parseMaterialized(value: string): MaterializedGeneration;
export declare function createQuery(materialized: MaterializedGeneration, release: () => void | Promise<void>): AnalysisQuery;
export declare function createSnapshotSet(values: ReadonlyMap<ProjectUniverseId, MaterializedGeneration>, inventory: SourceManifestId, open: (universe: ProjectUniverseId, generation: AnalysisGenerationId) => Promise<AnalysisQuery>, release: () => void | Promise<void>): AnalysisSnapshotSet;

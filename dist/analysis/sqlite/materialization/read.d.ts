import type { DatabaseSync } from 'node:sqlite';
import type { FactShardReference } from '../../facts/index.ts';
import type { AnalysisGeneration } from '../../generation/index.ts';
import type { AnalysisGenerationId, ProjectUniverseId } from '../../identity/index.ts';
import type { MaterializedGeneration } from '../../internal/state.ts';
import type { FactPayloadCodecMap } from '../../facts/representation/index.ts';
export declare function loadCurrentGeneration(database: DatabaseSync, storeNamespace: string, universe: ProjectUniverseId): AnalysisGeneration | undefined;
export declare function loadGeneration(database: DatabaseSync, storeNamespace: string, universe: ProjectUniverseId, generation?: AnalysisGenerationId): AnalysisGeneration | undefined;
export declare function loadManifest(database: DatabaseSync, storeNamespace: string, universe: ProjectUniverseId, sequence: number): readonly FactShardReference[];
/** Full reconstruction is reserved for migration, corruption audit, and tests. */
export declare function loadMaterializedGeneration(database: DatabaseSync, storeNamespace: string, generation: AnalysisGeneration, payloadCodecs: FactPayloadCodecMap, maximumDecompressedShardPayloadBytes?: number): MaterializedGeneration;

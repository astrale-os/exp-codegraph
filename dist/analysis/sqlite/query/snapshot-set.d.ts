import type { AnalysisGeneration } from '../../generation/index.ts';
import type { AnalysisGenerationId, ProjectUniverseId, SnapshotSetId, SourceManifestId } from '../../identity/index.ts';
import type { AnalysisQuery, AnalysisSnapshotSet } from '../../query/index.ts';
export declare class SQLiteSnapshotSet implements AnalysisSnapshotSet {
    #private;
    readonly id: SnapshotSetId;
    readonly inventory: SourceManifestId;
    readonly generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>;
    readonly universes: readonly ProjectUniverseId[];
    constructor(generations: ReadonlyMap<ProjectUniverseId, AnalysisGeneration>, inventory: SourceManifestId, openQuery: (universe: ProjectUniverseId, generation: AnalysisGenerationId) => Promise<AnalysisQuery>, release: () => void | Promise<void>);
    query(universe: ProjectUniverseId): Promise<AnalysisQuery>;
    [Symbol.asyncDispose](): Promise<void>;
    dispose(): Promise<void>;
}

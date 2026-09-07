import type { AnalysisGenerationId, ProjectUniverseId, SnapshotSetId, SourceManifestId } from '../identity/index.ts';
/** Derive the portable identity pinned by both memory and durable snapshot sets. */
export declare function deriveAnalysisSnapshotSetId(generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>, inventory: SourceManifestId): SnapshotSetId;

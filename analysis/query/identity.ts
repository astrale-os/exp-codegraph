import type {
  AnalysisGenerationId,
  ProjectUniverseId,
  SnapshotSetId,
  SourceManifestId,
} from '../identity/index.ts'
import { deriveAnalysisId } from '../identity/index.ts'

/** Derive the portable identity pinned by both memory and durable snapshot sets. */
export function deriveAnalysisSnapshotSetId(
  generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>,
  inventory: SourceManifestId,
): SnapshotSetId {
  const universes = [...generations.keys()].sort()
  return deriveAnalysisId(
    'snapshot-set',
    'astrale.analysis.snapshot-set.v2',
    {
      inventory,
      generations: universes.map((universe) => [universe, generations.get(universe)!]),
    },
  )
}

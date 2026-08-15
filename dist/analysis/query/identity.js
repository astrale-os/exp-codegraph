import { deriveAnalysisId } from '../identity/index.js';
/** Derive the portable identity pinned by both memory and durable snapshot sets. */
export function deriveAnalysisSnapshotSetId(generations, inventory) {
    const universes = [...generations.keys()].sort();
    return deriveAnalysisId('snapshot-set', 'astrale.analysis.snapshot-set.v2', {
        inventory,
        generations: universes.map((universe) => [universe, generations.get(universe)]),
    });
}
//# sourceMappingURL=identity.js.map
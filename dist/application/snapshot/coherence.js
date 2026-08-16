import { deriveAnalysisId } from '../../analysis/index.js';
/** Refuse to publish a normative snapshot compiled from bytes outside the pinned inventory. */
export function assertSpecificationInventory(specifications, inventory) {
    const files = new Map(inventory.files.map((file) => [file.path, file]));
    const mismatches = [];
    for (const specification of specifications) {
        for (const resource of specificationResources(specification)) {
            const file = files.get(resource.source);
            if (!file) {
                mismatches.push(`${resource.source}:not-in-inventory`);
                continue;
            }
            const revision = deriveAnalysisId('source-revision', `${file.source}`, {
                digest: resource.revision,
                encoding: 'bytes',
            });
            if (revision !== file.revision)
                mismatches.push(`${resource.source}:revision-mismatch`);
        }
        for (const reference of specification.sourceReferences) {
            if (!files.has(reference.target.source)) {
                mismatches.push(`${reference.target.source}:reference-target-not-in-inventory`);
            }
        }
    }
    if (mismatches.length) {
        throw new Error(`Specification sources changed during refresh: ${[...new Set(mismatches)].sort().join(', ')}`);
    }
}
function specificationResources(specification) {
    const resources = [
        ...(specification.module.api ? [specification.module.api] : []),
        ...(specification.module.code ? [specification.module.code] : []),
        ...(specification.module.internal ? [specification.module.internal] : []),
        ...specification.module.ports,
        ...specification.schemas,
        ...specification.examples,
        ...specification.capabilities,
        ...specification.flows,
        ...specification.laws,
        ...specification.states,
        ...(specification.limits ? [specification.limits] : []),
        ...(specification.layout ? [specification.layout] : []),
        ...specification.benchmarks,
        ...specification.packages,
        ...specification.packagePatterns,
        ...specification.module.packageAuthority.packages,
        ...specification.module.packageAuthority.packagePatterns,
    ];
    const expanded = resources.flatMap((resource) => [
        resource,
        ...(resource.model?.sources.map((source) => ({
            source: source.file,
            revision: source.revision,
        })) ?? []),
        ...(resource.model?.dependencies?.map((source) => ({
            source: source.file,
            revision: source.revision,
        })) ?? []),
    ]);
    return [...new Map(expanded.map((resource) => [resource.source, resource])).values()];
}
//# sourceMappingURL=coherence.js.map
import { applicationSelectionOwners } from '../selection/index.js';
/** Resolve a manifest-owned focused selection and its exact support closure without decoding owners. */
export function projectedApplicationCheckpointSources(owners, projection) {
    const dependencies = new Map(owners.map(({ source, dependencies }) => [source, new Set(dependencies)]));
    const selected = new Set(projection.requested.flatMap((target) => applicationSelectionOwners(owners, target).map(({ source }) => source)));
    if (projection.includeDependents) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const [source, imports] of dependencies) {
                if (selected.has(source) || ![...imports].some((item) => selected.has(item)))
                    continue;
                selected.add(source);
                changed = true;
            }
        }
    }
    const closure = new Set(selected);
    const pending = [...selected];
    while (pending.length) {
        for (const dependency of dependencies.get(pending.pop()) ?? []) {
            if (closure.has(dependency))
                continue;
            closure.add(dependency);
            pending.push(dependency);
        }
    }
    return closure;
}
/** Retain only dependency coordinates that are owned by the published corpus. */
export function applicationCheckpointSpecificationDependencies(specification, corpusSources) {
    return [...new Set([
            ...specification.sourceReferences.map(({ target }) => target.source),
            ...[
                specification.module.api,
                specification.module.internal,
                ...specification.module.ports,
            ].flatMap((resource) => resource?.model?.dependencies.map(({ file }) => file) ?? []),
        ].filter((source) => source !== specification.source && corpusSources.has(source)))]
        .sort((left, right) => left.localeCompare(right));
}
//# sourceMappingURL=projection.optimization.js.map
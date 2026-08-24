import { TYPESCRIPT_MODULE_FACT_NAMESPACE } from './model.js';
/** Carry exact inventory evidence in stable order without changing the legacy path hint. */
export function orderedNativeSourceChanges(values) {
    if (!values?.length)
        return;
    return [...new Map(values.map((value) => [value.path, value])).values()]
        .sort((left, right) => left.path.localeCompare(right.path));
}
/** Derive the exact owner projection changed by an incremental normalized-fact transaction. */
export function changedModuleSubjects(transaction) {
    if (!transaction)
        return [];
    if (!transaction.base)
        return;
    return [...new Set(transaction.upserts
            .filter((shard) => shard.namespace === TYPESCRIPT_MODULE_FACT_NAMESPACE)
            .flatMap((shard) => shard.facts)
            .filter((fact) => fact.kind === 'module')
            .map((fact) => fact.subject))].sort();
}
/** Retain only the source/dependency evidence required for exact project routing. */
export function moduleRouting(transaction) {
    if (!transaction)
        return;
    const modules = transaction.upserts
        .filter((shard) => shard.namespace === TYPESCRIPT_MODULE_FACT_NAMESPACE)
        .flatMap((shard) => shard.facts)
        .filter((fact) => fact.kind === 'module')
        .map((fact) => {
        const payload = fact.payload;
        return {
            module: fact.subject,
            files: [...payload.files].sort(),
            dependencies: [...new Set(payload.dependencies.map((edge) => edge.targetModule))].sort(),
        };
    })
        .sort((left, right) => left.module.localeCompare(right.module));
    return { complete: !transaction.base, modules };
}
//# sourceMappingURL=refresh.optimization.js.map
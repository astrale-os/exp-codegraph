import { createHash } from 'node:crypto';
/** Create one canonical path-independent source proof identity. */
export function createSourceProof(input) {
    const scope = {
        ...input.scope,
        exclude: [...new Set(input.scope.exclude)].sort(),
    };
    const overlay = [...input.overlay].sort(compareOverlay);
    const changedPaths = [...new Set(input.changedPaths)].sort();
    const value = {
        ...input,
        scope,
        overlay,
        changedPaths,
    };
    const id = `source-proof:${createHash('sha256')
        .update('astrale.codegraph.source-proof\0')
        .update(stableJson(value))
        .digest('hex')}`;
    return immutable({ ...value, id });
}
function compareOverlay(left, right) {
    return left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind);
}
function stableJson(value) {
    return JSON.stringify(canonical(value));
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const entry of Object.values(value))
        immutable(entry);
    return Object.freeze(value);
}
//# sourceMappingURL=identity.js.map
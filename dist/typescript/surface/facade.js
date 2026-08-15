/**
 * A facade may rename or omit canonical exports, but it cannot establish a second declaration
 * authority. Every declaration it exposes must already be public through the canonical entrypoint.
 */
export function compareEntrypointFacade(canonical, facade, location) {
    if (hasUnresolvedEntrypoint(facade))
        return [];
    const declared = new Set(canonical.exports.map(declarationFact));
    const unexpected = facade.exports
        .map(declarationFact)
        .filter((fact) => !declared.has(fact))
        .sort(compare);
    if (!unexpected.length)
        return [];
    return [
        {
            code: 'MODULE_ENTRYPOINT_FACADE_DRIFT',
            message: 'Public entrypoint facade exposes declarations outside the canonical entrypoint contract.',
            location,
            actual: { unexpected },
        },
    ];
}
function declarationFact(value) {
    return JSON.stringify({
        declaration: value.declaration,
        kind: value.kind,
        typeOnly: value.typeOnly,
    });
}
function hasUnresolvedEntrypoint(surface) {
    return surface.issues.some((issue) => issue.code === 'MODULE_ENTRYPOINT_NOT_IN_PROJECT' ||
        issue.code === 'MODULE_ENTRYPOINT_SYMBOL_UNRESOLVED');
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=facade.js.map
export function compareEntrypointAlias(canonical, alias, location) {
    if (hasUnresolvedEntrypoint(alias))
        return [];
    const expected = canonical.exports.map(exportFact).sort(compare);
    const actual = alias.exports.map(exportFact).sort(compare);
    if (sameFacts(expected, actual))
        return [];
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    return [
        {
            code: 'MODULE_ENTRYPOINT_ALIAS_DRIFT',
            message: 'Public entrypoint alias does not expose the canonical entrypoint surface exactly.',
            location,
            actual: {
                missing: expected.filter((fact) => !actualSet.has(fact)),
                unexpected: actual.filter((fact) => !expectedSet.has(fact)),
            },
        },
    ];
}
function exportFact(value) {
    return JSON.stringify({
        path: value.path,
        name: value.name,
        declaration: value.declaration,
        kind: value.kind,
        typeOnly: value.typeOnly,
    });
}
function sameFacts(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function hasUnresolvedEntrypoint(surface) {
    return surface.issues.some((issue) => issue.code === 'MODULE_ENTRYPOINT_NOT_IN_PROJECT' ||
        issue.code === 'MODULE_ENTRYPOINT_SYMBOL_UNRESOLVED');
}
//# sourceMappingURL=alias.js.map
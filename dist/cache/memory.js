export function cacheEntries(cache) {
    return [...cache];
}
export function restoreCacheEntries(snapshot, capacity, isValue) {
    if (!Array.isArray(snapshot))
        return [];
    const entries = [];
    for (const candidate of snapshot.slice(-capacity)) {
        if (!Array.isArray(candidate) ||
            candidate.length !== 2 ||
            typeof candidate[0] !== 'string' ||
            !isValue(candidate[1]))
            continue;
        entries.push([candidate[0], candidate[1]]);
    }
    return entries;
}
export function record(value) {
    return typeof value === 'object' && value !== null;
}
export function stringRecord(value) {
    return record(value) && typeof value.file === 'string' && typeof value.revision === 'string';
}
//# sourceMappingURL=memory.js.map
const caches = new WeakMap();
/** Index one immutable Program once while retaining owner-local closure projection. */
export function declarationMetadataIndexOnce(checker, root, collect) {
    const cache = checkerCache(checker, root);
    if (cache.index)
        return cache.index;
    cache.index = collect();
    return cache.index;
}
/** Materialize one checker/node/symbol metadata value only when an owner actually requests it. */
export function declarationMetadataOnce(checker, root, candidate, materialize) {
    const cache = checkerCache(checker, root);
    let bySymbol = cache.metadata.get(candidate.node);
    if (!bySymbol) {
        bySymbol = new WeakMap();
        cache.metadata.set(candidate.node, bySymbol);
    }
    const existing = bySymbol.get(candidate.symbol);
    if (existing)
        return existing;
    const metadata = materialize();
    bySymbol.set(candidate.symbol, metadata);
    return metadata;
}
function checkerCache(checker, root) {
    let byRoot = caches.get(checker);
    if (!byRoot) {
        byRoot = new Map();
        caches.set(checker, byRoot);
    }
    const existing = byRoot.get(root);
    if (existing)
        return existing;
    const created = {
        metadata: new WeakMap(),
    };
    byRoot.set(root, created);
    return created;
}
//# sourceMappingURL=metadata.optimization.js.map
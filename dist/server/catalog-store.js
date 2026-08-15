import { specPayloadKey } from './catalog-snapshot.js';
/** Retain the current snapshot plus a bounded content-addressed payload history for HMR races. */
export class CatalogSnapshotStore {
    #current;
    #specs = new Map();
    #sources = new Map();
    #specCapacity;
    #sourceCapacity;
    constructor(options = {}) {
        this.#specCapacity = positiveInteger(options.specCapacity, 128);
        this.#sourceCapacity = positiveInteger(options.sourceCapacity, 1_024);
    }
    get current() {
        return this.#current;
    }
    publish(snapshot) {
        const previous = this.#current;
        const previousRevisions = new Map(previous?.index.specs.map((entry) => [entry.source, entry.revision]) ?? []);
        const nextSources = new Set(snapshot.index.specs.map((entry) => entry.source));
        const changedSpecs = snapshot.index.specs
            .filter((entry) => previousRevisions.get(entry.source) !== entry.revision)
            .map((entry) => entry.source);
        const removedSpecs = previous
            ? previous.index.specs
                .filter((entry) => !nextSources.has(entry.source))
                .map((entry) => entry.source)
            : [];
        for (const [key, payload] of snapshot.specs)
            remember(this.#specs, key, payload);
        for (const [key, payload] of snapshot.sources)
            remember(this.#sources, key, payload);
        this.#current = snapshot;
        this.#prune();
        return {
            changed: previous?.index.generation !== snapshot.index.generation,
            generation: snapshot.index.generation,
            changedSpecs,
            removedSpecs,
        };
    }
    spec(source, revision) {
        return recall(this.#specs, specPayloadKey(source, revision));
    }
    source(key) {
        return recall(this.#sources, key);
    }
    #prune() {
        const protectedSpecs = new Set(this.#current?.specs.keys() ?? []);
        const protectedSources = new Set(this.#current?.sources.keys() ?? []);
        prune(this.#specs, this.#specCapacity, protectedSpecs);
        prune(this.#sources, this.#sourceCapacity, protectedSources);
    }
}
function remember(entries, key, value) {
    entries.delete(key);
    entries.set(key, value);
}
function recall(entries, key) {
    const value = entries.get(key);
    if (value === undefined)
        return;
    remember(entries, key, value);
    return value;
}
function prune(entries, capacity, protectedKeys) {
    if (entries.size <= capacity)
        return;
    for (const key of entries.keys()) {
        if (entries.size <= capacity)
            return;
        if (!protectedKeys.has(key))
            entries.delete(key);
    }
}
function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
//# sourceMappingURL=catalog-store.js.map
import { types } from 'node:util';
import { RequestFrequency } from './frequency.js';
/** Project-owned, byte-bounded admission and invalidation across models and budgets. */
export class ValueResolutionCache {
    #entries = new Map();
    #readers = new Map();
    #groups = new Map();
    #witnessIds = new WeakMap();
    #models = new WeakMap();
    #maximumEntries;
    #maximumBytes;
    #frequency;
    #revision;
    #lineage = {};
    #nextModel = 0;
    #nextWitness = 0;
    #bytes = 0;
    #closed = false;
    constructor(maximumEntries = Infinity, maximumBytes = 8 * 1024 * 1024) {
        this.#maximumEntries = maximumEntries;
        this.#maximumBytes = maximumBytes;
        this.#frequency = new RequestFrequency(maximumBytes);
    }
    model(model) {
        if (!model)
            return 0;
        let id = this.#models.get(model);
        if (id === undefined)
            this.#models.set(model, (id = ++this.#nextModel));
        return id;
    }
    dependency(witness) {
        const resident = this.#readers.get(witness.key)?.witness;
        return resident && resident.fingerprint === witness.fingerprint ? resident : witness;
    }
    /** Only resident bases are interned; rejected demands add no retained registry entry. */
    basis(dependencies, evidence, limits) {
        const ordered = [...new Map(Array.from(dependencies, dependency => [dependency.key, this.dependency(dependency)])).values()];
        const ids = ordered.map((dependency) => {
            let id = this.#witnessIds.get(dependency);
            if (id === undefined)
                this.#witnessIds.set(dependency, (id = ++this.#nextWitness));
            return id;
        });
        const key = JSON.stringify([limits.maximumDepth, limits.maximumSteps, limits.maximumAlternatives, ids, evidence]);
        return this.#groups.get(key)?.basis ?? Object.freeze({ key,
            dependencies: Object.freeze(ordered), evidence: Object.freeze([...evidence]), limits });
    }
    get(key, valid, revision) {
        if (this.#closed)
            return;
        if (revision)
            this.advance(revision);
        else if (this.#revision) {
            this.#revision = undefined;
            this.#lineage = {};
        }
        this.#frequency.record(key);
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        // Direct deltas removed changed readers; a discontinuous reader must first
        // authenticate its shared basis against its own immutable index.
        if (!(revision && entry.group?.lineage === this.#lineage) && !valid(entry.result)) {
            this.remove(entry);
            return;
        }
        if (revision && entry.group)
            entry.group.lineage = this.#lineage;
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        return entry.result;
    }
    put(key, result, bytes, basis) {
        if (this.#closed)
            return;
        // One inverse membership per entry; shared bases own the dependency graph.
        bytes += key.length * 2 + 224;
        if (bytes + this.#frequency.bytes > this.#maximumBytes)
            return;
        const previous = this.#entries.get(key);
        if (previous)
            this.remove(previous);
        // Also supports independently constructed readers with no revision journal.
        // A newly observed fingerprint retires all cached bases that read its old value.
        for (const dependency of basis?.dependencies ?? []) {
            const readers = this.#readers.get(dependency.key);
            if (readers && readers.witness.fingerprint !== dependency.fingerprint)
                for (const group of readers.groups)
                    for (const entry of group.entries)
                        this.remove(entry);
        }
        let group = basis && this.#groups.get(basis.key);
        const groupBytes = basis ? group?.bytes ?? basisBytes(basis) : 0;
        if (groupBytes === undefined)
            return;
        let added = bytes;
        if (basis && !group) {
            added += groupBytes;
            for (const dependency of basis.dependencies)
                if (!this.#readers.has(dependency.key))
                    added += dependencyBytes(dependency);
        }
        if (added + this.#frequency.bytes > this.#maximumBytes)
            return;
        const victims = [];
        let released = 0;
        const frequency = this.#frequency.estimate(key);
        for (const entry of this.#entries.values()) {
            if (this.#entries.size - victims.length < this.#maximumEntries && this.bytes - released + added <= this.#maximumBytes)
                break;
            // Keep already useful work when a large scan brings equally cold demands.
            if (frequency <= this.#frequency.estimate(entry.key))
                return;
            victims.push(entry);
            released += entry.bytes;
        }
        if (this.#entries.size - victims.length >= this.#maximumEntries || this.bytes - released + added > this.#maximumBytes)
            return;
        for (const entry of victims)
            this.remove(entry);
        // The last reader of this basis may have been among the evicted entries.
        group = basis && this.#groups.get(basis.key);
        if (basis && !group) {
            group = { basis, entries: new Set(), bytes: groupBytes, ...(this.#revision ? { lineage: this.#lineage } : {}) };
            this.#groups.set(basis.key, group);
            this.#bytes += group.bytes;
            for (const dependency of basis.dependencies) {
                let readers = this.#readers.get(dependency.key);
                if (!readers) {
                    readers = { witness: dependency, groups: new Set(), bytes: dependencyBytes(dependency) };
                    this.#readers.set(dependency.key, readers);
                    this.#bytes += readers.bytes;
                }
                readers.groups.add(group);
            }
        }
        const entry = { key, result, bytes, ...(group ? { group } : {}) };
        this.#entries.set(key, entry);
        this.#bytes += bytes;
        if (group) {
            group.entries.add(entry);
            group.lineage = this.#revision ? this.#lineage : undefined;
        }
    }
    advance(revision) {
        if (this.#revision === revision.token)
            return;
        if (this.#revision === undefined || revision.parent !== this.#revision)
            this.#lineage = {};
        else
            for (const key of revision.changed) {
                const readers = this.#readers.get(key);
                if (readers)
                    for (const group of readers.groups)
                        for (const entry of group.entries)
                            this.remove(entry);
            }
        this.#revision = revision.token;
    }
    remove(entry) {
        if (!this.#entries.delete(entry.key))
            return;
        this.#bytes -= entry.bytes;
        const group = entry.group;
        if (!group)
            return;
        group.entries.delete(entry);
        if (group.entries.size)
            return;
        this.#groups.delete(group.basis.key);
        this.#bytes -= group.bytes;
        for (const dependency of group.basis.dependencies) {
            const readers = this.#readers.get(dependency.key);
            readers.groups.delete(group);
            if (!readers.groups.size) {
                this.#readers.delete(dependency.key);
                this.#bytes -= readers.bytes;
            }
        }
    }
    clear() { this.#entries.clear(); this.#readers.clear(); this.#groups.clear(); this.#bytes = 0; }
    close() { this.#closed = true; this.clear(); this.#frequency = undefined; this.#revision = undefined; }
    get size() { return this.#entries.size; }
    get bytes() { return this.#bytes + (this.#frequency?.bytes ?? 0); }
}
function dependencyBytes(dependency) {
    return 192 + dependency.key.length * 2 + (dependency.fingerprint?.length ?? 0) * 2;
}
function basisBytes(basis) {
    const shared = resolutionResultBytes({ evidence: basis.evidence, limits: basis.limits });
    return shared === undefined ? undefined : 192 + basis.key.length * 2 + basis.dependencies.length * 48 + shared;
}
/** Estimate owned storage only for deeply immutable, portable result graphs. */
export function resolutionResultBytes(input, shared = []) {
    let bytes = 0;
    const seen = new Set();
    const inspect = (value, depth) => {
        if (depth > 128 || bytes > 1024 * 1024)
            throw undefined;
        if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
            bytes += 16;
            return;
        }
        if (typeof value === 'string') {
            bytes += 32 + value.length * 2;
            return;
        }
        if (typeof value !== 'object' || types.isProxy(value))
            throw undefined;
        if (shared.includes(value)) {
            bytes += 8;
            return;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype)
            throw undefined;
        // The engine owns the outer receipt and freezes it after attaching metadata.
        // Every nested object, including opaque model atoms, must already be frozen.
        if (depth > 0 && !Object.isFrozen(value))
            throw undefined;
        if (seen.has(value))
            return;
        seen.add(value);
        bytes += 64;
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!('value' in descriptor))
                throw undefined;
            bytes += 32 + (typeof key === 'string' ? key.length * 2 : 16);
            inspect(descriptor.value, depth + 1);
        }
    };
    try {
        inspect(input, 0);
        return bytes <= 1024 * 1024 ? bytes : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=cache.js.map
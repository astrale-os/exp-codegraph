import { createTypeScriptStructuralReader } from '../structure/reader.js';
import { createValueEvaluatorFactory } from '../value/symbolic/engine.js';
import { ComputationReceipt, COMPUTATION_RECEIPT_BYTES, COMPUTATION_WITNESS_BYTES, recordComputationWitness } from '../value/symbolic/receipt.js';
import { capturePortable, restorePortable } from './portable.js';
/** Expiration detaches the whole invocation, including its backing query. */
class ComputationReader {
    #delegate;
    constructor(delegate) { this.#delegate = delegate; }
    read() {
        if (!this.#delegate)
            throw new Error('A semantic reader can only be used during its computation.');
        return this.#delegate;
    }
    async calls(...options) { return this.read().calls(...options); }
    async values(options) { return this.read().values(options); }
    async structure() { return this.read().structure(); }
    dispose() { this.#delegate = undefined; }
}
const structuralKey = (key) => `structure:${key}`;
/** One project-owned admission policy, with no callback or snapshot retained. */
export class SemanticComputationCache {
    #values;
    #entries = new Map();
    #building = new Set();
    #generation;
    #revision = {};
    #closed = false;
    constructor(values) { this.#values = values; }
    committed(generation) { this.#generation = generation.id; }
    async run(query, load, observe, input, check, signal, structuralLoad) {
        check();
        signal?.throwIfAborted();
        // Capture before the first await. The callback and its key see the same data.
        const captured = capturePortable(input);
        const key = captured ? `${this.#values.model(observe)}:${captured.encoded.toString('base64')}` : undefined;
        const current = () => !this.#closed && this.#generation === query.generation.id;
        let active = true, admissible = true, observing = false;
        let release;
        let receipt;
        let witnesses;
        let factory;
        let structuralReader;
        let reader;
        let values;
        let structure;
        let valueRevision;
        let structuralRevision;
        const checked = () => {
            check();
            signal?.throwIfAborted();
            if (!active)
                throw new Error('A semantic reader can only be used during its computation.');
        };
        const releaseConstruction = () => {
            receipt = undefined;
            witnesses = undefined;
            if (release) {
                release();
                this.#building.delete(release);
                release = undefined;
            }
        };
        const abandon = () => { admissible = false; releaseConstruction(); };
        const constructionBytes = COMPUTATION_RECEIPT_BYTES * 2 + COMPUTATION_WITNESS_BYTES + (key?.length ?? 0) * 2 + 512;
        const construct = (reconciled) => {
            if (!key || !current() || !admissible || receipt)
                return;
            // Before a callback identifies its read domain, never evict proof entries
            // to retain an obsolete computation. Its first read reconciles that domain.
            if (!reconciled && this.#values.bytes + constructionBytes > this.#values.capacity)
                return;
            release = this.reserve(key, constructionBytes);
            if (!release) {
                if (reconciled)
                    admissible = false;
                return;
            }
            this.#building.add(release);
            receipt = new ComputationReceipt();
            witnesses = new Float64Array(COMPUTATION_WITNESS_BYTES / Float64Array.BYTES_PER_ELEMENT);
        };
        const loadValues = async () => {
            try {
                checked();
                const index = await cancellable(values ??= Promise.resolve().then(load), signal);
                checked();
                valueRevision = index.revision;
                if (current())
                    this.reconcile('values', index.revision);
                if (observing)
                    construct(true);
                return index;
            }
            catch (error) {
                abandon();
                throw error;
            }
        };
        const loadStructure = async () => {
            try {
                checked();
                if (!structuralLoad)
                    throw new Error('Structural analysis is unavailable in this computation.');
                const index = await cancellable(structure ??= Promise.resolve().then(structuralLoad), signal);
                checked();
                structuralRevision = index.revision;
                if (current())
                    this.reconcile('structure', index.revision);
                if (observing)
                    construct(true);
                return index;
            }
            catch (error) {
                abandon();
                throw error;
            }
        };
        try {
            const candidate = key && current() ? this.#entries.get(key) : undefined;
            if (candidate) {
                // A structural-only receipt never loads the value/body index, even when
                // another cached computation consumed it in this project.
                if (candidate.values)
                    await loadValues();
                if (candidate.structure)
                    await loadStructure();
                if (key && current()) {
                    const entry = this.get(key);
                    if (entry)
                        return restorePortable(entry.encoded);
                }
            }
            observing = true;
            construct(valueRevision !== undefined || structuralRevision !== undefined);
            const scope = {
                signal, check: checked, fail: abandon,
                proof: (basis) => {
                    if (receipt)
                        for (const dependency of basis.dependencies) {
                            if (recordComputationWitness(witnesses, this.#values.witnessIdentity(dependency)))
                                receipt.add(dependency.key);
                        }
                },
                selection: (revision, keys) => {
                    if (revision?.token !== valueRevision?.token || revision?.selection !== 'typescript.calls/v1')
                        abandon();
                    else if (receipt)
                        for (const key of keys)
                            receipt.add(key);
                },
            };
            factory = createValueEvaluatorFactory(query, this.#values, loadValues, scope);
            reader = new ComputationReader({
                calls: factory.calls, values: factory,
                structure: async () => {
                    checked();
                    return structuralReader ??= createTypeScriptStructuralReader(loadStructure, {
                        signal, check: checked,
                        selection: (revision, keys) => {
                            if (revision.token !== structuralRevision?.token || revision.selection !== 'typescript.structure/v1')
                                abandon();
                            else if (receipt)
                                for (const key of keys)
                                    receipt.add(structuralKey(key));
                        },
                    });
                },
            });
            Object.freeze(reader);
            const result = await cancellable(Promise.resolve().then(() => {
                checked();
                return observe(reader, captured ? captured.value : input);
            }), signal);
            checked();
            const portable = captured && capturePortable(result);
            if (!portable)
                return result;
            const retained = receipt?.compact();
            releaseConstruction();
            if (key && retained && current()) {
                const bytes = portable.encoded.buffer.byteLength + retained.bytes + key.length * 2 + 512;
                const reservation = this.reserve(key, bytes);
                if (reservation)
                    this.#entries.set(key, { encoded: portable.encoded, receipt: retained,
                        ...(valueRevision ? { values: valueRevision.token } : {}),
                        ...(structuralRevision ? { structure: structuralRevision.token } : {}), release: reservation });
            }
            return portable.value;
        }
        finally {
            active = false;
            reader?.dispose();
            reader = undefined;
            releaseConstruction();
            factory?.dispose();
            structuralReader?.dispose();
            structuralReader = undefined;
            // An escaped, expired reader must not retain materialized revision graphs.
            values = undefined;
            structure = undefined;
            valueRevision = undefined;
            structuralRevision = undefined;
        }
    }
    reconcile(domain, revision) {
        if (this.#revision[domain] === revision.token)
            return;
        // Reconcile all variants for this read domain before reserving new work.
        // Promotion does not change LRU order or retire an independent domain.
        const selection = domain === 'values' ? 'typescript.calls/v1' : 'typescript.structure/v1';
        let candidates = 0;
        for (const [key, entry] of this.#entries) {
            if (!entry[domain] || entry[domain] === revision.token)
                continue;
            if (revision.selection !== selection || revision.parent !== entry[domain])
                this.remove(key, entry);
            else
                candidates++;
        }
        const changed = domain === 'values' ? revision.changed : (function* () {
            for (const key of revision.changed)
                yield structuralKey(key);
        })();
        if (candidates)
            for (const digest of ComputationReceipt.hashes(changed)) {
                for (const [key, entry] of this.#entries) {
                    if (entry[domain] && entry[domain] !== revision.token && entry.receipt.mayContain(digest)) {
                        this.remove(key, entry);
                        candidates--;
                    }
                }
                if (!candidates)
                    break;
            }
        for (const entry of this.#entries.values())
            if (entry[domain])
                entry[domain] = revision.token;
        this.#revision[domain] = revision.token;
    }
    get(key) {
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        return entry;
    }
    reserve(key, bytes) {
        if (bytes > this.#values.capacity)
            return;
        const previous = this.#entries.get(key);
        if (previous)
            this.remove(key, previous);
        let reservation = this.#values.reserve(bytes);
        for (const [key, entry] of this.#entries) {
            if (reservation)
                break;
            this.remove(key, entry);
            reservation = this.#values.reserve(bytes);
        }
        return reservation;
    }
    remove(key, entry) { this.#entries.delete(key); entry.release(); }
    close() {
        this.#closed = true;
        delete this.#revision.values;
        delete this.#revision.structure;
        for (const [key, entry] of this.#entries)
            this.remove(key, entry);
        for (const release of this.#building)
            release();
        this.#building.clear();
    }
}
function cancellable(work, signal) {
    if (!signal)
        return work;
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        // Keep the underlying callback handled even when its caller has already left.
        work.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
        if (signal.aborted) {
            signal.removeEventListener('abort', abort);
            abort();
        }
    });
}

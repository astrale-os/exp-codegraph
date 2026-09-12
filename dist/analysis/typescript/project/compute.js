import { createValueEvaluatorFactory } from '../value/symbolic/engine.js';
import { ComputationReceipt, COMPUTATION_RECEIPT_BYTES, COMPUTATION_WITNESS_BYTES, recordComputationWitness } from '../value/symbolic/receipt.js';
import { capturePortable, restorePortable } from './portable.js';
/** One project-owned admission policy, with no callback or snapshot retained. */
export class SemanticComputationCache {
    #values;
    #entries = new Map();
    #building = new Set();
    #generation;
    #closed = false;
    constructor(values) { this.#values = values; }
    committed(generation) { this.#generation = generation.id; }
    async run(query, load, observe, input, check, signal) {
        check();
        signal?.throwIfAborted();
        // Capture before the first await. The callback and its key see the same data.
        const captured = capturePortable(input);
        const key = captured ? `${this.#values.model(observe)}:${captured.encoded.toString('base64')}` : undefined;
        const index = await cancellable(load(), signal);
        check();
        signal?.throwIfAborted();
        const current = () => !this.#closed && this.#generation === query.generation.id;
        if (key && current()) {
            const entry = this.get(key, index.revision);
            if (entry)
                return restorePortable(entry.encoded);
        }
        let active = true;
        // Includes temporary witness tags and simultaneously live folded tables.
        let release = key && current() ? this.reserve(key, COMPUTATION_RECEIPT_BYTES * 2 + COMPUTATION_WITNESS_BYTES + key.length * 2 + 512) : undefined;
        let receipt;
        let witnesses;
        let factory;
        const abandon = () => {
            receipt = undefined;
            witnesses = undefined;
            if (release) {
                release();
                this.#building.delete(release);
                release = undefined;
            }
        };
        try {
            if (release) {
                this.#building.add(release);
                receipt = new ComputationReceipt();
                witnesses = new Float64Array(COMPUTATION_WITNESS_BYTES / Float64Array.BYTES_PER_ELEMENT);
            }
            const scope = {
                signal,
                check: () => {
                    check();
                    signal?.throwIfAborted();
                    if (!active)
                        throw new Error('A semantic reader can only be used during its computation.');
                },
                fail: abandon,
                proof: (basis) => {
                    if (receipt)
                        for (const dependency of basis.dependencies) {
                            if (recordComputationWitness(witnesses, this.#values.witnessIdentity(dependency)))
                                receipt.add(dependency.key);
                        }
                },
                selection: (revision, keys) => {
                    if (revision?.token !== index.revision.token || revision.selection !== 'typescript.calls/v1')
                        abandon();
                    else if (receipt)
                        for (const key of keys)
                            receipt.add(key);
                },
            };
            factory = createValueEvaluatorFactory(query, this.#values, load, scope);
            const reader = Object.freeze({ calls: factory.calls, values: factory });
            const result = await cancellable(Promise.resolve().then(() => {
                scope.check();
                return observe(reader, captured ? captured.value : input);
            }), signal);
            scope.check();
            const portable = captured && capturePortable(result);
            if (!portable)
                return result;
            const retained = receipt?.compact();
            abandon();
            if (key && retained && current()) {
                const bytes = portable.encoded.buffer.byteLength + retained.bytes + key.length * 2 + 512;
                const reservation = this.reserve(key, bytes);
                if (reservation)
                    this.#entries.set(key, { encoded: portable.encoded, receipt: retained,
                        revision: index.revision.token, release: reservation });
            }
            return portable.value;
        }
        finally {
            active = false;
            abandon();
            factory?.dispose();
        }
    }
    get(key, revision) {
        const entry = this.#entries.get(key);
        if (!entry)
            return;
        if (entry.revision !== revision.token && (revision.selection !== 'typescript.calls/v1' ||
            revision.parent !== entry.revision || entry.receipt.intersects(revision.changed))) {
            this.remove(key, entry);
            return;
        }
        entry.revision = revision.token;
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
//# sourceMappingURL=compute.js.map
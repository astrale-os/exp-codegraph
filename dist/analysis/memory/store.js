import { dispatchAnalysisTelemetry } from '../profiling/dispatch.js';
import { createQuery, createSnapshotSet, materializeTransaction, } from '../internal/state.js';
export function createMemoryAnalysisStore(options = {}) {
    return new MemoryAnalysisStore(options);
}
class MemoryAnalysisStore {
    #maximumRetained;
    #telemetry;
    #universes = new Map();
    #current = new Map();
    #disposed = false;
    constructor(options) {
        this.#maximumRetained = options.maximumRetainedGenerations ?? 4;
        this.#telemetry = options.telemetry;
        if (!Number.isSafeInteger(this.#maximumRetained) || this.#maximumRetained < 1) {
            throw new RangeError('maximumRetainedGenerations must be a positive integer.');
        }
    }
    async current(universe) {
        this.assertOpen();
        return this.currentValue(universe)?.generation;
    }
    async commit(transaction, options = {}) {
        this.assertOpen();
        options.signal?.throwIfAborted();
        const started = this.#telemetry ? process.hrtime.bigint() : 0n;
        const universe = transaction.next.universe;
        const next = materializeTransaction(this.currentValue(universe), transaction);
        options.signal?.throwIfAborted();
        let retained = this.#universes.get(universe);
        if (!retained) {
            retained = new Map();
            this.#universes.set(universe, retained);
        }
        retained.set(next.generation.sequence, { value: next, leases: 0 });
        this.#current.set(universe, next.generation.sequence);
        this.collect(universe);
        if (this.#telemetry) {
            dispatchAnalysisTelemetry(this.#telemetry, {
                component: 'memory-store',
                phase: 'transaction.commit',
                durationNs: Number(process.hrtime.bigint() - started),
                metrics: {
                    manifestShards: transaction.manifest.length,
                    upsertShards: transaction.upserts.length,
                    deleteShards: transaction.deletes.length,
                    upsertFacts: transaction.upserts.reduce((total, shard) => total + shard.facts.length, 0),
                },
            });
        }
    }
    async open(universe, generation) {
        this.assertOpen();
        const retained = this.retained(universe, generation);
        retained.leases++;
        return createQuery(retained.value, () => {
            retained.leases--;
            this.collect(universe);
        });
    }
    async snapshotSet(generations, inventory) {
        this.assertOpen();
        const retained = new Map();
        try {
            for (const [universe, generation] of generations) {
                const entry = this.retained(universe, generation);
                entry.leases++;
                retained.set(universe, entry);
            }
        }
        catch (error) {
            for (const entry of retained.values())
                entry.leases--;
            throw error;
        }
        return createSnapshotSet(new Map([...retained].map(([universe, entry]) => [universe, entry.value])), inventory, (universe, generation) => this.open(universe, generation), () => {
            for (const [universe, entry] of retained) {
                entry.leases--;
                this.collect(universe);
            }
        });
    }
    async [Symbol.asyncDispose]() {
        await this.dispose();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#current.clear();
        this.#universes.clear();
    }
    currentValue(universe) {
        const sequence = this.#current.get(universe);
        return sequence ? this.#universes.get(universe)?.get(sequence)?.value : undefined;
    }
    retained(universe, generation) {
        const values = this.#universes.get(universe);
        const sequence = generation
            ? [...(values?.entries() ?? [])]
                .filter(([, entry]) => entry.value.generation.id === generation)
                .sort(([left], [right]) => right - left)[0]?.[0]
            : this.#current.get(universe);
        if (!sequence)
            throw new Error(`No analysis generation exists for universe ${universe}.`);
        const retained = values?.get(sequence);
        if (!retained) {
            throw new Error(`Analysis generation ${generation ?? String(sequence)} is not retained.`);
        }
        return retained;
    }
    collect(universe) {
        const values = this.#universes.get(universe);
        if (!values || values.size <= this.#maximumRetained)
            return;
        const current = this.#current.get(universe);
        const candidates = [...values]
            .filter(([sequence, retained]) => sequence !== current && retained.leases === 0)
            .sort(([, left], [, right]) => left.value.generation.sequence - right.value.generation.sequence);
        while (values.size > this.#maximumRetained && candidates.length) {
            values.delete(candidates.shift()[0]);
        }
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('Analysis store is disposed.');
    }
}
//# sourceMappingURL=store.js.map
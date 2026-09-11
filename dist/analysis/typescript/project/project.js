import { resolve } from 'node:path';
import { createMemoryAnalysisStore } from '../../memory/index.js';
import { createProcessNativeAnalysisSessionFactory } from '../../protocol/index.js';
import { resolvePackagedNativeAnalysis } from '../distribution/index.js';
import { createTypeScriptAnalysisService } from '../service.js';
import { createTypeScriptFactReader } from '../facts/index.js';
import { TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../physical/index.js';
import { resolveBoundedValueLimits } from '../value/index.js';
import { createValueEvaluatorFactory } from '../value/symbolic/engine.js';
import { ValueResolutionCache } from '../value/symbolic/cache.js';
import { ValueIndexOwner } from '../value/symbolic/owner.js';
import { SemanticComputationCache } from './compute.js';
/** Open a headless project using the installed native analyzer and a caller-local memory store. */
export async function openTypeScriptProject(options) {
    if (options.sessions && options.binary)
        throw new TypeError('Choose sessions or binary, not both.');
    const sessions = options.sessions ?? createProcessNativeAnalysisSessionFactory({
        command: (await resolvePackagedNativeAnalysis({ binary: options.binary })).command,
        payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS,
    });
    const descriptor = {
        root: resolve(options.root),
        config: options.config ?? 'tsconfig.json',
        capabilities: [...new Set(options.capabilities ?? [
                'typescript.source', 'typescript.symbol', 'typescript.occurrence', 'typescript.body',
            ])],
        ...(options.modules ? { modules: options.modules.map((module) => ({
                ...module, facades: [...module.facades], aliases: [...module.aliases], internals: [...module.internals],
            })) } : {}),
    };
    return new ResidentProject(descriptor, sessions, options.store ?? createMemoryAnalysisStore({ maximumRetainedUniverses: 2 }), !options.store);
}
class ResidentProject {
    #service;
    #universe;
    #currentReader;
    #tail = Promise.resolve();
    #closed = false;
    #closing;
    #readers = new Set();
    #lifetime = new AbortController();
    #descriptor;
    #sessions;
    #store;
    #ownsStore;
    #writer;
    #pending = [];
    #pendingSources = new Set();
    #sourceShards = new Map();
    #values = new ValueResolutionCache();
    #computations = new SemanticComputationCache(this.#values);
    #index = new ValueIndexOwner();
    constructor(descriptor, sessions, store, ownsStore) {
        this.#descriptor = descriptor;
        this.#sessions = sessions;
        this.#store = store;
        this.#ownsStore = ownsStore;
        this.#writer = {
            current: (universe) => store.current(universe),
            open: (universe, generation) => store.open(universe, generation),
            snapshotSet: (generations, inventory) => store.snapshotSet(generations, inventory),
            dispose: () => Promise.resolve(),
            commit: async (transaction, options) => {
                await store.commit(transaction, options);
                this.#index.committed(transaction);
                this.#computations.committed(transaction.next);
                this.#pending.push(transaction);
                let sourcesByShard = this.#sourceShards.get(transaction.next.universe);
                if (!sourcesByShard)
                    this.#sourceShards.set(transaction.next.universe, (sourcesByShard = new Map()));
                for (const key of transaction.deletes) {
                    for (const source of sourcesByShard.get(key) ?? [])
                        this.#pendingSources.add(source);
                    sourcesByShard.delete(key);
                }
                for (const shard of transaction.upserts) {
                    if (shard.namespace !== 'typescript.source')
                        continue;
                    const sources = shard.facts.map((fact) => fact.payload.source);
                    sourcesByShard.set(shard.key, sources);
                    for (const source of sources)
                        this.#pendingSources.add(source);
                }
            },
        };
    }
    refresh(options = {}) {
        // Capture mutable caller input before queued work yields.
        const request = { ...options,
            signal: options.signal ? AbortSignal.any([options.signal, this.#lifetime.signal]) : this.#lifetime.signal,
            ...(options.changed ? { changed: [...options.changed] } : {}),
            ...(options.changes ? { changes: options.changes.map((change) => ({ ...change })) } : {}),
        };
        return this.enqueue(async () => {
            request.signal?.throwIfAborted();
            try {
                this.#service ??= await createTypeScriptAnalysisService({
                    project: this.#descriptor,
                    sessions: { open: (project) => this.#sessions.open(project, { signal: request.signal }) },
                    store: this.#writer,
                    ...(this.#universe ? { universe: this.#universe } : {}),
                });
                request.signal.throwIfAborted();
                const result = await this.#service.refresh(request);
                this.#computations.committed(result.generation);
                this.#universe = result.generation.universe;
                if (this.#currentReader?.generation.id !== result.generation.id) {
                    const next = await this.#store.open(result.generation.universe, result.generation.id);
                    if (this.#closed) {
                        await next.dispose();
                        throw new Error('TypeScript project is disposed.');
                    }
                    const previous = this.#currentReader;
                    this.#currentReader = next;
                    await previous?.dispose();
                }
                const transactions = Object.freeze(this.#pending.splice(0));
                const changedSources = Object.freeze([...new Set([...this.#pendingSources, ...result.changedSources])].sort());
                this.#pendingSources.clear();
                return Object.freeze({ generation: result.generation,
                    transactions, changedSources,
                    diagnostics: result.diagnostics, durationMs: result.durationMs });
            }
            catch (error) {
                // The store owns the last complete generation. A failed/aborted native process is disposable.
                const failed = this.#service;
                this.#universe = failed?.universe ?? this.#universe;
                this.#service = undefined;
                await failed?.dispose().catch(() => { });
                throw error;
            }
            finally {
                await this.collectSourceShards();
            }
        });
    }
    open(generation) {
        return this.enqueue(async () => {
            const universe = generation?.universe ?? this.#universe;
            if (!universe)
                throw new Error('Refresh the TypeScript project before opening a snapshot.');
            const query = await this.#store.open(universe, generation?.id);
            if (this.#closed) {
                await query.dispose();
                throw new Error('TypeScript project is disposed.');
            }
            const index = this.#index.acquire(query);
            const makeEvaluator = createValueEvaluatorFactory(query, this.#values, index.load);
            const evaluators = new Map();
            let disposed = false;
            const lifetime = new AbortController();
            const snapshot = Object.freeze({
                generation: query.generation,
                query,
                facts: createTypeScriptFactReader(query),
                calls: (options = {}) => disposed
                    ? Promise.reject(new Error('TypeScript project snapshot is disposed.'))
                    : makeEvaluator.calls(options),
                values: (input = {}) => {
                    if (disposed)
                        return Promise.reject(new Error('TypeScript project snapshot is disposed.'));
                    const limits = resolveBoundedValueLimits(input.limits);
                    const key = `${limits.maximumDepth}/${limits.maximumSteps}/${limits.maximumAlternatives}`;
                    let models = evaluators.get(input.call);
                    if (!models)
                        evaluators.set(input.call, (models = new Map()));
                    let evaluator = models.get(key);
                    if (!evaluator) {
                        evaluator = makeEvaluator({ ...input, limits }).catch((error) => {
                            models.delete(key);
                            throw error;
                        });
                        models.set(key, evaluator);
                    }
                    return evaluator;
                },
                compute: (observe, input, options = {}) => this.#computations.run(query, index.load, observe, input, () => {
                    if (disposed)
                        throw new Error('TypeScript project snapshot is disposed.');
                }, options.signal ? AbortSignal.any([options.signal, lifetime.signal, this.#lifetime.signal])
                    : AbortSignal.any([lifetime.signal, this.#lifetime.signal])),
                dispose: async () => {
                    if (disposed)
                        return;
                    disposed = true;
                    lifetime.abort(new Error('TypeScript project snapshot is disposed.'));
                    this.#readers.delete(snapshot);
                    evaluators.clear();
                    makeEvaluator.dispose();
                    index.release();
                    await query.dispose();
                    await this.collectSourceShards();
                },
                async [Symbol.asyncDispose]() { await snapshot.dispose(); },
            });
            this.#readers.add(snapshot);
            return snapshot;
        });
    }
    dispose() {
        if (this.#closing)
            return this.#closing;
        this.#closed = true;
        this.#computations.close();
        this.#values.close();
        this.#index.close();
        this.#lifetime.abort(new Error('TypeScript project is disposed.'));
        this.#closing = (async () => {
            // Stop a running native request before awaiting queued work, then release its pinned evidence.
            const stopping = Promise.allSettled([this.#service?.dispose()]);
            await this.#tail;
            const cleanup = [...await stopping, ...await Promise.allSettled([
                    this.#service?.dispose(),
                    this.#currentReader?.dispose(),
                    ...[...this.#readers].map((reader) => reader.dispose()),
                ])];
            this.#currentReader = undefined;
            this.#service = undefined;
            if (this.#ownsStore)
                await this.#store.dispose();
            this.#pending.length = 0;
            this.#pendingSources.clear();
            this.#sourceShards.clear();
            const failed = cleanup.find((result) => result.status === 'rejected');
            if (failed?.status === 'rejected')
                throw failed.reason;
        })();
        return this.#closing;
    }
    async [Symbol.asyncDispose]() { await this.dispose(); }
    async collectSourceShards() {
        if (!this.#ownsStore)
            return;
        const universes = [...this.#sourceShards.keys()];
        const retained = await Promise.all(universes.map((universe) => this.#store.current(universe)));
        universes.forEach((universe, index) => { if (!retained[index])
            this.#sourceShards.delete(universe); });
    }
    enqueue(work) {
        if (this.#closed)
            return Promise.reject(new Error('TypeScript project is disposed.'));
        const result = this.#tail.then(() => {
            if (this.#closed)
                throw new Error('TypeScript project is disposed.');
            return work();
        });
        this.#tail = result.then(() => { }, () => { });
        return result;
    }
}
//# sourceMappingURL=project.js.map
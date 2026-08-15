import { performance } from 'node:perf_hooks';
import { isAbsolute, relative } from 'node:path';
import { shardReference } from '../facts/index.js';
import { bindPhysicalFact } from '../facts/representation/index.js';
import { generationIdentity } from '../generation/index.js';
import { deriveAnalysisId, portablePath } from '../identity/index.js';
import { createMemoryAnalysisStore } from '../memory/index.js';
import { planPasses, runPortablePasses } from '../pass/index.js';
import { NATIVE_ANALYSIS_PROTOCOL_VERSION, } from '../protocol/index.js';
import { materializeNativeDelta, materializeNativeTransaction } from './universe-transaction.js';
/**
 * Compose one private resident compiler lineage with portable passes and publish
 * exactly one complete generation to the caller-owned store.
 */
export async function createTypeScriptAnalysisPipeline(options) {
    const session = await options.sessions.open(options.project);
    return new ResidentTypeScriptAnalysisPipeline(options, session);
}
class ResidentTypeScriptAnalysisPipeline {
    #universe;
    #nativeStore = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 });
    #nativeShards = new Map();
    #portableShards = new Map();
    #request = 0;
    #disposed = false;
    #options;
    #session;
    constructor(options, session) {
        this.#options = options;
        this.#session = session;
    }
    get universe() {
        return this.#universe;
    }
    async refresh(options = {}) {
        this.assertOpen();
        options.signal?.throwIfAborted();
        const started = performance.now();
        const activeUniverse = this.#universe;
        const nativeBase = activeUniverse
            ? await this.#nativeStore.current(activeUniverse)
            : undefined;
        const response = await this.#session.request({
            id: ++this.#request,
            kind: 'refresh',
            ...(nativeBase ? { base: nativeBase.id } : {}),
            ...(nativeBase ? { baseSequence: nativeBase.sequence } : {}),
            ...(options.changed ? { changed: [...options.changed].sort() } : {}),
            ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
        }, { signal: options.signal });
        if (response.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION) {
            throw new Error(`Native analysis protocol ${response.protocolVersion} is incompatible with ${NATIVE_ANALYSIS_PROTOCOL_VERSION}.`);
        }
        if (response.kind === 'error') {
            throw new Error(`Native analysis ${response.code}: ${response.message}`);
        }
        let nativeTransaction;
        let changedNamespaces = new Set();
        if (response.kind === 'transaction' || response.kind === 'delta') {
            const materialized = response.kind === 'delta'
                ? await materializeNativeDelta(this.#nativeStore, nativeBase, response.delta, { signal: options.signal })
                : await materializeNativeTransaction(this.#nativeStore, activeUniverse, nativeBase, response.transaction, { signal: options.signal });
            const admitted = materialized.transaction
                ?? (response.kind === 'transaction' ? response.transaction : undefined);
            if (!admitted)
                throw new Error('Native delta materialization omitted its transaction.');
            changedNamespaces = transactionNamespaces(this.#nativeShards, admitted);
            if (materialized.rollover) {
                this.#nativeShards.clear();
                this.#portableShards.clear();
            }
            applyShards(this.#nativeShards, admitted);
            nativeTransaction = admitted;
            if (this.#session.acknowledge) {
                await this.#session.acknowledge({
                    id: ++this.#request,
                    generation: materialized.generation.id,
                    sequence: materialized.generation.sequence,
                }, { signal: options.signal });
            }
            this.#universe = materialized.generation.universe;
        }
        else if (response.kind === 'acknowledged') {
            throw new Error('Native analysis acknowledged a generation without a commit request.');
        }
        else if (!nativeBase || response.generation !== nativeBase.id) {
            throw new Error('Native analysis reported unchanged for a non-current private generation.');
        }
        const universe = this.#universe;
        if (!universe)
            throw new Error('Native analysis did not establish a project universe.');
        const nativeGeneration = await this.#nativeStore.current(universe);
        if (!nativeGeneration)
            throw new Error('Native analysis did not establish a generation.');
        const nativeQuery = await this.#nativeStore.open(universe, nativeGeneration.id);
        try {
            const nativeManifest = await nativeQuery.manifest();
            assertCompleteShards(this.#nativeShards, nativeManifest, 'native');
            const schemas = uniqueSchemas(nativeManifest);
            const plan = planPasses(this.#options.passes.map((pass) => pass.manifest), this.#options.requestedCapabilities, {
                availableCapabilities: nativeGeneration.capabilities,
                availableSchemas: schemas,
            });
            const invalidated = invalidatedPortablePasses(plan.ordered, this.#portableShards, changedNamespaces, options.invalidate === true);
            const selectedPlan = {
                ...plan,
                ordered: plan.ordered.filter((manifest) => invalidated.has(manifest.id)),
            };
            const portable = selectedPlan.ordered.length
                ? await runPortablePasses({
                    plan: selectedPlan,
                    passes: this.#options.passes,
                    query: nativeQuery,
                    carriedShards: [...this.#portableShards.values()],
                    producer: this.#options.producer,
                    ...(options.signal ? { signal: options.signal } : {}),
                })
                : carryPortablePasses(nativeGeneration, nativeManifest, [...this.#portableShards.values()], plan, this.#options.producer);
            options.signal?.throwIfAborted();
            const stagedGeneration = portable.transaction?.next ?? nativeGeneration;
            const stagedManifest = portable.transaction?.manifest ?? nativeManifest;
            const stagedShards = new Map([...this.#nativeShards, ...this.#portableShards]);
            if (portable.transaction)
                applyShards(stagedShards, portable.transaction);
            assertCompleteShards(stagedShards, stagedManifest, 'staged');
            replacePortableShards(this.#portableShards, stagedShards, this.#options.passes.flatMap((pass) => pass.manifest.outputs.map((output) => output.namespace)));
            const current = await this.#options.store.current(universe);
            const currentManifest = current
                ? await withQuery(this.#options.store.open(universe, current.id), (query) => query.manifest())
                : [];
            const transaction = publishTransaction(current, currentManifest, stagedGeneration, stagedManifest, stagedShards);
            if (transaction) {
                await this.#options.store.commit(transaction, { signal: options.signal });
            }
            return {
                generation: transaction?.next ?? current ?? stagedGeneration,
                ...(transaction ? { transaction } : {}),
                changedSources: changedSources(this.#options.project.root, universe, nativeTransaction, options.changed),
                invalidatedPasses: [
                    ...new Set([
                        ...passesFrom(nativeTransaction),
                        ...portable.executed,
                    ]),
                ].sort(),
                diagnostics: portable.diagnostics.map(formatDiagnostic),
                durationMs: performance.now() - started,
            };
        }
        finally {
            await nativeQuery.dispose();
        }
    }
    async [Symbol.asyncDispose]() {
        await this.dispose();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        const results = await Promise.allSettled([this.#session.dispose(), this.#nativeStore.dispose()]);
        const rejected = results.find((result) => result.status === 'rejected');
        if (rejected)
            throw rejected.reason;
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('TypeScript analysis pipeline is disposed.');
    }
}
function carryPortablePasses(native, nativeManifest, portable, plan, producer) {
    if (!portable.length)
        return { executed: [], unavailable: [], diagnostics: [] };
    const manifest = [...nativeManifest, ...portable.map(shardReference)].sort(byReference);
    const generation = {
        universe: native.universe,
        producer,
        sourceManifest: native.sourceManifest,
        capabilities: [
            ...new Set([
                ...native.capabilities,
                ...plan.capabilities,
                ...plan.ordered.flatMap((pass) => pass.providesCapabilities),
            ]),
        ].sort(),
    };
    const id = generationIdentity(generation, manifest);
    return {
        transaction: {
            protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
            base: native.id,
            next: { ...generation, id, sequence: native.sequence + 1 },
            manifest,
            upserts: [],
            deletes: [],
        },
        executed: [],
        unavailable: [],
        diagnostics: [],
    };
}
function transactionNamespaces(previous, transaction) {
    return new Set([
        ...transaction.upserts.map((shard) => shard.namespace),
        ...transaction.deletes.flatMap((key) => {
            const shard = previous.get(key);
            return shard ? [shard.namespace] : [];
        }),
    ]);
}
function invalidatedPortablePasses(manifests, carried, changedNamespaces, invalidateAll) {
    const invalidated = new Set();
    const invalidatedCapabilities = new Set();
    for (const manifest of manifests) {
        const currentOutputs = manifest.outputs.every((output) => [...carried.values()].some((shard) => shard.namespace === output.namespace && shard.schemaVersion === output.version));
        const direct = invalidateAll ||
            !currentOutputs ||
            manifest.inputs.some((input) => changedNamespaces.has(input.namespace)) ||
            manifest.invalidatesOn.some((selector) => [...changedNamespaces].some((namespace) => matchesInvalidation(selector, namespace))) ||
            manifest.requiresCapabilities.some((capability) => invalidatedCapabilities.has(capability));
        if (!direct)
            continue;
        invalidated.add(manifest.id);
        for (const capability of manifest.providesCapabilities)
            invalidatedCapabilities.add(capability);
    }
    return invalidated;
}
function matchesInvalidation(selector, namespace) {
    if (selector === '*')
        return true;
    if (selector.endsWith('.*')) {
        const prefix = selector.slice(0, -1);
        return namespace.startsWith(prefix);
    }
    return selector === namespace;
}
function replacePortableShards(target, staged, namespaces) {
    const portable = new Set(namespaces);
    target.clear();
    for (const [key, shard] of staged) {
        if (portable.has(shard.namespace))
            target.set(key, shard);
    }
}
function applyShards(shards, transaction) {
    for (const key of transaction.deletes)
        shards.delete(key);
    for (const shard of transaction.upserts)
        shards.set(shard.key, shard);
}
function publishTransaction(current, currentManifest, staged, stagedManifest, stagedShards) {
    if (current?.id === staged.id && sameReferences(currentManifest, stagedManifest))
        return undefined;
    const currentByKey = new Map(currentManifest.map((reference) => [reference.key, reference]));
    const nextKeys = new Set(stagedManifest.map((reference) => reference.key));
    return {
        protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
        ...(current ? { base: current.id } : {}),
        next: {
            ...staged,
            sequence: (current?.sequence ?? 0) + 1,
        },
        manifest: stagedManifest,
        upserts: [...stagedShards.values()]
            .filter((shard) => currentByKey.get(shard.key)?.digest !== shard.digest)
            .map((shard) => bindGeneration(shard, staged.id))
            .sort(byShard),
        deletes: currentManifest
            .filter((reference) => !nextKeys.has(reference.key))
            .map((reference) => reference.key)
            .sort(),
    };
}
function assertCompleteShards(shards, manifest, stage) {
    const actual = [...shards.values()].map(shardReference).sort(byReference);
    if (!sameReferences(actual, manifest)) {
        throw new Error(`The ${stage} analysis manifest is not a complete materialized snapshot.`);
    }
}
function uniqueSchemas(manifest) {
    const versions = new Map();
    for (const reference of manifest) {
        const current = versions.get(reference.namespace);
        if (current !== undefined && current !== reference.schemaVersion) {
            throw new Error(`Native namespace ${reference.namespace} has conflicting schema versions ${current} and ${reference.schemaVersion}.`);
        }
        versions.set(reference.namespace, reference.schemaVersion);
    }
    return [...versions]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([namespace, version]) => ({ namespace, version }));
}
function bindGeneration(shard, generation) {
    return { ...shard, facts: shard.facts.map((fact) => bindPhysicalFact(fact, generation)) };
}
function changedSources(root, universe, transaction, changed) {
    return [
        ...new Set([
            ...(transaction?.upserts ?? [])
                .filter((shard) => shard.namespace === 'typescript.source')
                .flatMap((shard) => shard.facts.flatMap((fact) => {
                const source = fact.payload.source;
                return source ? [source] : [];
            })),
            ...(changed ?? []).map((path) => deriveAnalysisId('source', `typescript:${universe}`, {
                path: logicalChangedPath(root, path),
            })),
        ]),
    ].sort();
}
function passesFrom(transaction) {
    return [
        ...new Set((transaction?.upserts ?? []).flatMap((shard) => shard.facts.map((fact) => fact.provenance.pass))),
    ].sort();
}
function formatDiagnostic(fact) {
    return `${fact.kind}:${fact.subject}:${fact.id}`;
}
async function withQuery(queryPromise, read) {
    const query = await queryPromise;
    try {
        return await read(query);
    }
    finally {
        await query.dispose();
    }
}
function logicalChangedPath(root, path) {
    return portablePath(isAbsolute(path) ? relative(root, path).replaceAll('\\', '/') : path);
}
function sameReferences(left, right) {
    return (left.length === right.length &&
        left.every((reference, index) => {
            const candidate = right[index];
            return candidate?.key === reference.key && candidate.digest === reference.digest;
        }));
}
function byReference(left, right) {
    return left.key.localeCompare(right.key);
}
function byShard(left, right) {
    return left.key.localeCompare(right.key);
}
//# sourceMappingURL=pipeline.js.map
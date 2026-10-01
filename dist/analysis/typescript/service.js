import { performance } from 'node:perf_hooks';
import { isAbsolute, relative } from 'node:path';
import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from '../protocol/index.js';
import { captureBodyDemand } from '../protocol/body-demand.js';
import { deriveAnalysisId, portablePath } from '../identity/index.js';
import { dispatchAnalysisTelemetry } from '../profiling/dispatch.js';
import { materializeNativeDelta, materializeNativeTransaction, } from './universe-transaction.js';
import { changedModuleSubjects, moduleRouting, orderedNativeSourceChanges, } from './refresh.optimization.js';
export async function createTypeScriptAnalysisService(options) {
    const session = await options.sessions.open(options.project);
    return new ResidentTypeScriptAnalysisService(options, session);
}
class ResidentTypeScriptAnalysisService {
    #universe;
    #request = 0;
    #disposed = false;
    #options;
    #session;
    constructor(options, session) {
        this.#options = options;
        this.#session = session;
        this.#universe = options.universe;
    }
    get universe() {
        return this.#universe;
    }
    async refresh(input = {}) {
        const options = { ...input,
            ...(input.changed ? { changed: [...input.changed] } : {}),
            ...(input.changes ? { changes: input.changes.map((change) => ({ ...change })) } : {}),
            ...(input.bodyDemand ? { bodyDemand: captureBodyDemand(input.bodyDemand) } : {}),
        };
        const started = performance.now();
        let result = await this.refreshOnce(options);
        if (!options.discover)
            return result;
        const changedSources = new Set(result.changedSources);
        const invalidatedPasses = new Set(result.invalidatedPasses);
        const changedModules = new Set(result.changedModules ?? []);
        let scopeUnknown = result.changedModules === undefined;
        let transaction = result.transaction;
        let moduleRouting = result.moduleRouting;
        for (let attempt = 0; result.transaction; attempt++) {
            if (attempt >= 3) {
                throw new Error('Compiler inputs kept changing during discovery refresh.');
            }
            // A replayed candidate must be acknowledged before the native owner can
            // reconcile filesystem changes. Never return that intermediate snapshot.
            result = await this.refreshOnce({ discover: true, signal: options.signal,
                ...(options.bodyDemand ? { bodyDemand: options.bodyDemand } : {}),
            });
            transaction = result.transaction ?? transaction;
            moduleRouting = result.moduleRouting ?? moduleRouting;
            for (const source of result.changedSources)
                changedSources.add(source);
            for (const pass of result.invalidatedPasses)
                invalidatedPasses.add(pass);
            scopeUnknown ||= result.changedModules === undefined;
            for (const module of result.changedModules ?? [])
                changedModules.add(module);
        }
        return {
            ...result,
            ...(transaction ? { transaction } : {}),
            ...(moduleRouting ? { moduleRouting } : {}),
            changedSources: [...changedSources].sort(),
            invalidatedPasses: [...invalidatedPasses].sort(),
            ...(scopeUnknown
                ? { changedModules: undefined }
                : { changedModules: [...changedModules].sort() }),
            durationMs: performance.now() - started,
        };
    }
    async refreshOnce(options = {}) {
        this.assertOpen();
        const started = performance.now();
        const request = this.#request + 1;
        const activeUniverse = this.#universe;
        let phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n;
        const current = activeUniverse
            ? await this.#options.store.current(activeUniverse)
            : undefined;
        this.emit('store.current', request, phaseStarted);
        phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n;
        const response = await this.#session.request({
            id: ++this.#request,
            kind: 'refresh',
            ...(current ? { base: current.id } : {}),
            ...(current ? { baseSequence: current.sequence } : {}),
            ...(options.changed ? { changed: [...options.changed].sort() } : {}),
            ...(options.changes ? { changes: orderedNativeSourceChanges(options.changes) } : {}),
            ...(options.discover !== undefined ? { discover: options.discover } : {}),
            ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
            ...(options.bodyDemand ? { bodyDemand: { paths: [...options.bodyDemand.paths] } } : {}),
        }, { signal: options.signal });
        this.emit('native.request', request, phaseStarted, { responseKind: response.kind });
        if (response.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION) {
            throw new Error(`Native analysis protocol ${response.protocolVersion} is incompatible with ${NATIVE_ANALYSIS_PROTOCOL_VERSION}.`);
        }
        if (response.kind === 'error') {
            throw new Error(`Native analysis ${response.code}: ${response.message}`);
        }
        if (response.kind === 'unchanged') {
            if (!current || response.generation !== current.id) {
                throw new Error('Native analysis reported unchanged for a non-current generation.');
            }
            return {
                generation: current,
                changedSources: [],
                changedModules: [],
                invalidatedPasses: [],
                diagnostics: [],
                durationMs: performance.now() - started,
            };
        }
        if (response.kind === 'acknowledged') {
            throw new Error('Native analysis acknowledged a generation without a commit request.');
        }
        phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n;
        const materialized = response.kind === 'delta'
            ? await materializeNativeDelta(this.#options.store, current, response.delta, { signal: options.signal })
            : await materializeNativeTransaction(this.#options.store, activeUniverse, current, response.transaction, { signal: options.signal });
        const transaction = materialized.transaction
            ?? (response.kind === 'transaction' ? response.transaction : undefined);
        if (!transaction)
            throw new Error('Native delta materialization omitted its transaction.');
        this.emit('transaction.materialize', request, phaseStarted, {
            manifestShards: transaction.manifest.length,
            upsertShards: transaction.upserts.length,
            deleteShards: transaction.deletes.length,
        });
        if (this.#session.acknowledge) {
            await this.#session.acknowledge({
                id: ++this.#request,
                generation: materialized.generation.id,
                sequence: materialized.generation.sequence,
            }, { signal: options.signal });
        }
        this.#universe = materialized.generation.universe;
        const universe = materialized.generation.universe;
        const changedSources = [
            ...new Set([
                ...transaction.upserts
                    .filter((shard) => shard.namespace === 'typescript.source')
                    .flatMap((shard) => shard.facts.map((fact) => fact.payload.source)),
                ...(options.changed ?? []).map((path) => deriveAnalysisId('source', `typescript:${universe}`, {
                    path: logicalChangedPath(this.#options.project.root, path),
                })),
            ]),
        ].sort();
        const invalidatedPasses = [
            ...new Set(transaction.upserts.flatMap((shard) => shard.facts.map((fact) => fact.provenance.pass))),
        ].sort();
        const changedModules = changedModuleSubjects(transaction);
        const routing = moduleRouting(transaction);
        return {
            generation: materialized.generation,
            ...(materialized.transaction ? { transaction: materialized.transaction } : {}),
            changedSources,
            ...(changedModules !== undefined ? { changedModules } : {}),
            ...(routing ? { moduleRouting: routing } : {}),
            invalidatedPasses,
            diagnostics: [],
            durationMs: performance.now() - started,
        };
    }
    async [Symbol.asyncDispose]() {
        await this.dispose();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        await this.#session.dispose();
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('TypeScript analysis service is disposed.');
    }
    emit(phase, request, started, metrics) {
        if (!this.#options.telemetry)
            return;
        dispatchAnalysisTelemetry(this.#options.telemetry, {
            component: 'analysis',
            phase,
            request,
            durationNs: Number(process.hrtime.bigint() - started),
            ...(metrics ? { metrics } : {}),
        });
    }
}
function logicalChangedPath(root, path) {
    return portablePath(isAbsolute(path) ? relative(root, path).replaceAll('\\', '/') : path);
}

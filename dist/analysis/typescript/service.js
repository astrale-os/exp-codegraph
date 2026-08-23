import { performance } from 'node:perf_hooks';
import { isAbsolute, relative } from 'node:path';
import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from '../protocol/index.js';
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
    async refresh(options = {}) {
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
            ...(options.invalidate !== undefined ? { invalidate: options.invalidate } : {}),
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
//# sourceMappingURL=service.js.map
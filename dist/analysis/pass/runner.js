import { factHeader, factShardDigest, shardReference, validateFactShard } from '../facts/index.js';
import { bindPhysicalFact } from '../facts/representation/index.js';
import { generationIdentity } from '../generation/index.js';
import { deriveAnalysisId } from '../identity/index.js';
export async function runPortablePasses(options) {
    options.signal?.throwIfAborted();
    const implementations = new Map(options.passes.map((pass) => [pass.manifest.id, pass]));
    const nativeManifest = await options.query.manifest();
    const baseCapabilities = await options.query.capabilities();
    const carried = [...(options.carriedShards ?? [])].sort(byShard);
    assertCarriedShards(nativeManifest, carried);
    const baseManifest = [...nativeManifest, ...carried.map(shardReference)].sort(byKey);
    let manifest = [...baseManifest];
    const outputs = new Map(carried.map((shard) => [shard.key, shard]));
    const executed = [];
    const unavailable = [];
    const diagnostics = [];
    const replacedNamespaces = new Set();
    for (const planned of options.plan.ordered) {
        options.signal?.throwIfAborted();
        if (planned.runtime !== 'portable-typescript') {
            throw new Error(`Portable runner cannot execute native pass ${planned.id}.`);
        }
        const pass = implementations.get(planned.id);
        if (!pass || !sameManifest(pass.manifest, planned)) {
            throw new Error(`Portable pass ${planned.id} has no exact implementation.`);
        }
        const query = new StagedQuery(options.query, manifest, outputs.values(), mergeCapabilityStatus(baseCapabilities, outputs.values()), planned.inputs.map((input) => input.namespace));
        let output;
        try {
            output = await pass.run({
                generation: options.query.generation,
                query,
                ...(options.signal ? { signal: options.signal } : {}),
            });
            options.signal?.throwIfAborted();
            output = normalizeOutput(pass.manifest, output);
        }
        catch (error) {
            if (options.signal?.aborted)
                options.signal.throwIfAborted();
            if (planned.mandatory) {
                throw new Error(`Mandatory portable pass ${planned.id} failed.`, { cause: error });
            }
            unavailable.push(planned.id);
            output = unavailableOutput(planned, error);
        }
        finally {
            await query.dispose();
        }
        executed.push(planned.id);
        diagnostics.push(...output.diagnostics);
        const namespaces = new Set(planned.outputs.map((schema) => schema.namespace));
        for (const namespace of namespaces)
            replacedNamespaces.add(namespace);
        manifest = manifest.filter((reference) => !namespaces.has(reference.namespace));
        for (const [key, shard] of [...outputs]) {
            if (namespaces.has(shard.namespace))
                outputs.delete(key);
        }
        for (const shard of output.shards) {
            const existing = outputs.get(shard.key);
            if (existing)
                throw new Error(`Portable passes emitted duplicate shard key ${shard.key}.`);
            outputs.set(shard.key, shard);
            manifest.push(shardReference(shard));
        }
        manifest.sort(byKey);
    }
    if (!executed.length && !carried.length) {
        return { executed, unavailable, diagnostics };
    }
    const capabilities = [
        ...new Set([
            ...options.query.generation.capabilities,
            ...options.plan.capabilities,
            ...options.plan.ordered.flatMap((pass) => pass.providesCapabilities),
        ]),
    ].sort();
    const generation = {
        universe: options.query.generation.universe,
        producer: options.producer,
        sourceManifest: options.query.generation.sourceManifest,
        capabilities,
    };
    const id = generationIdentity(generation, manifest);
    if (id === options.query.generation.id && sameReferences(baseManifest, manifest)) {
        return { executed, unavailable, diagnostics };
    }
    const baseByKey = new Map(baseManifest.map((reference) => [reference.key, reference]));
    const upserts = [...outputs.values()]
        .filter((shard) => baseByKey.get(shard.key)?.digest !== shard.digest)
        .map((shard) => bindGeneration(shard, id))
        .sort(byShard);
    const nextKeys = new Set(manifest.map((reference) => reference.key));
    const deletes = baseManifest
        .filter((reference) => replacedNamespaces.has(reference.namespace) && !nextKeys.has(reference.key))
        .map((reference) => reference.key)
        .sort();
    const transaction = {
        protocolVersion: 1,
        base: options.query.generation.id,
        next: {
            ...generation,
            id,
            sequence: options.query.generation.sequence + 1,
        },
        manifest,
        upserts,
        deletes,
    };
    return { transaction, executed, unavailable, diagnostics };
}
function assertCarriedShards(native, carried) {
    const nativeKeys = new Set(native.map((reference) => reference.key));
    const nativeNamespaces = new Set(native.map((reference) => reference.namespace));
    const keys = new Set();
    for (const shard of carried) {
        const diagnostics = validateFactShard(shard);
        if (diagnostics.length) {
            throw new Error(`Cannot carry invalid portable shard ${shard.key}: ${diagnostics.join(', ')}`);
        }
        if (nativeKeys.has(shard.key) || keys.has(shard.key)) {
            throw new Error(`Carried portable shard key collides with staged analysis: ${shard.key}.`);
        }
        if (nativeNamespaces.has(shard.namespace)) {
            throw new Error(`Portable output namespace collides with native analysis: ${shard.namespace}.`);
        }
        keys.add(shard.key);
    }
}
function normalizeOutput(manifest, output) {
    const schemas = new Map(manifest.outputs.map((schema) => [schema.namespace, schema.version]));
    const capabilities = [...new Set(manifest.providesCapabilities)].sort();
    const shards = [];
    for (const emitted of output.shards) {
        const emittedIssues = validateFactShard(emitted);
        if (emittedIssues.length) {
            throw new Error(`Pass ${manifest.id} emitted invalid shard: ${emittedIssues.join(', ')}`);
        }
        const draft = { ...emitted, capabilities };
        const shard = { ...draft, digest: factShardDigest(draft) };
        const version = schemas.get(shard.namespace);
        if (version === undefined || version !== shard.schemaVersion) {
            throw new Error(`Pass ${manifest.id} emitted undeclared schema ${shard.namespace}@${shard.schemaVersion}.`);
        }
        for (const fact of shard.facts) {
            if (fact.provenance.pass !== manifest.id || fact.provenance.passVersion !== manifest.version) {
                throw new Error(`Pass ${manifest.id} emitted unattributable fact ${fact.id}.`);
            }
        }
        shards.push(shard);
    }
    for (const schema of manifest.outputs) {
        if (!shards.some((shard) => shard.namespace === schema.namespace)) {
            shards.push(completionShard(manifest, schema, output.completion));
        }
    }
    shards.sort(byShard);
    if (new Set(shards.map((shard) => shard.key)).size !== shards.length) {
        throw new Error(`Pass ${manifest.id} emitted duplicate shard keys.`);
    }
    for (const diagnostic of output.diagnostics) {
        if (diagnostic.provenance.pass !== manifest.id ||
            diagnostic.provenance.passVersion !== manifest.version) {
            throw new Error(`Pass ${manifest.id} emitted an unattributable diagnostic.`);
        }
    }
    return { ...output, shards, diagnostics: [...output.diagnostics].sort(byFact) };
}
function unavailableOutput(manifest, error) {
    const completion = {
        kind: 'unavailable',
        reasons: [
            {
                code: 'PASS_FAILED',
                message: error instanceof Error ? error.message : String(error),
                attributableTo: manifest.id,
                retryable: false,
            },
        ],
    };
    return {
        completion,
        shards: manifest.outputs.map((schema) => completionShard(manifest, schema, completion)),
        diagnostics: [],
    };
}
function completionShard(manifest, schema, completion) {
    const draft = {
        key: deriveAnalysisId('fact-shard-key', schema.namespace, {
            pass: manifest.id,
            scope: manifest.scope,
            completion: true,
        }),
        namespace: schema.namespace,
        schemaVersion: schema.version,
        completion,
        facts: [],
        capabilities: [...new Set(manifest.providesCapabilities)].sort(),
    };
    return { ...draft, digest: factShardDigest(draft) };
}
function bindGeneration(shard, generation) {
    return {
        ...shard,
        facts: shard.facts.map((fact) => bindPhysicalFact(fact, generation)),
    };
}
class StagedQuery {
    #disposed = false;
    generation;
    #base;
    #references;
    #stagedFacts;
    #stagedHeaders;
    #stagedById;
    #stagedHeaderById;
    #status;
    #allowedNamespaces;
    constructor(base, references, stagedShards, status, allowedNamespaces) {
        this.generation = base.generation;
        this.#base = base;
        this.#allowedNamespaces = new Set(allowedNamespaces);
        this.#references = references.filter((reference) => this.#allowedNamespaces.has(reference.namespace));
        this.#stagedFacts = [...stagedShards]
            .filter((shard) => this.#allowedNamespaces.has(shard.namespace))
            .flatMap((shard) => shard.facts.map((fact) => bindPhysicalFact(fact, base.generation.id)))
            .sort(byFact);
        this.#stagedHeaders = this.#stagedFacts.map(factHeader);
        this.#stagedById = new Map(this.#stagedFacts.map((fact) => [fact.id, fact]));
        this.#stagedHeaderById = new Map(this.#stagedHeaders.map((header) => [header.id, header]));
        this.#status = status;
    }
    async manifest() {
        this.assertOpen();
        return this.#references;
    }
    async capabilities() {
        this.assertOpen();
        return this.#status;
    }
    async headers(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 10_000) {
            throw new RangeError('Fact page limit must be an integer from 1 through 10000.');
        }
        if (!this.#allowedNamespaces.size) {
            return { headers: [], ...(page.includeTotal ? { total: 0 } : {}) };
        }
        const selected = this.inputFilter(filter);
        const start = decodeStagedCursor(page.cursor);
        const headers = [];
        let index = 0;
        let hasNext = false;
        for await (const header of this.exportHeaders(selected)) {
            const position = index++;
            if (position < start)
                continue;
            if (headers.length < page.limit) {
                headers.push(header);
                continue;
            }
            hasNext = true;
            if (!page.includeTotal)
                break;
        }
        return {
            headers,
            ...(hasNext ? { nextCursor: String(start + headers.length) } : {}),
            ...(page.includeTotal ? { total: index } : {}),
        };
    }
    async headersById(ids) {
        this.assertOpen();
        if (!this.#allowedNamespaces.size)
            return [];
        const wanted = [...new Set(ids)].sort();
        const staged = wanted.flatMap((id) => {
            const header = this.#stagedHeaderById.get(id);
            return header ? [header] : [];
        });
        const stagedIds = new Set(staged.map((header) => header.id));
        const base = await this.#base.headersById(wanted.filter((id) => !stagedIds.has(id)));
        for (const header of base)
            this.assertInputNamespace(header.namespace);
        return [...base, ...staged].sort(byHeader);
    }
    async *exportHeaders(filter = {}) {
        this.assertOpen();
        if (!this.#allowedNamespaces.size)
            return;
        const selected = this.inputFilter(filter);
        const staged = this.#stagedHeaders.filter((header) => matchesHeader(header, selected));
        const base = this.#base.exportHeaders(selected)[Symbol.asyncIterator]();
        let baseValue = await base.next();
        let stagedIndex = 0;
        try {
            while (!baseValue.done || stagedIndex < staged.length) {
                this.assertOpen();
                const baseHeader = baseValue.done ? undefined : baseValue.value;
                const stagedHeader = staged[stagedIndex];
                if (!baseHeader || (stagedHeader && stagedHeader.id.localeCompare(baseHeader.id) < 0)) {
                    yield stagedHeader;
                    stagedIndex++;
                    continue;
                }
                if (stagedHeader?.id === baseHeader.id) {
                    throw new Error(`Staged portable fact collides with base fact ${baseHeader.id}.`);
                }
                this.assertInputNamespace(baseHeader.namespace);
                yield baseHeader;
                baseValue = await base.next();
            }
        }
        finally {
            await base.return?.();
        }
    }
    async facts(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 10_000) {
            throw new RangeError('Fact page limit must be an integer from 1 through 10000.');
        }
        if (!this.#allowedNamespaces.size) {
            return { facts: [], ...(page.includeTotal ? { total: 0 } : {}) };
        }
        const selected = this.inputFilter(filter);
        const start = decodeStagedCursor(page.cursor);
        const facts = [];
        let index = 0;
        let hasNext = false;
        for await (const fact of this.export(selected)) {
            const position = index++;
            if (position < start)
                continue;
            if (facts.length < page.limit) {
                facts.push(fact);
                continue;
            }
            hasNext = true;
            if (!page.includeTotal)
                break;
        }
        return {
            facts,
            ...(hasNext ? { nextCursor: String(start + facts.length) } : {}),
            ...(page.includeTotal ? { total: index } : {}),
        };
    }
    async factsById(ids) {
        this.assertOpen();
        if (!this.#allowedNamespaces.size)
            return [];
        const wanted = [...new Set(ids)].sort();
        const staged = wanted.flatMap((id) => {
            const fact = this.#stagedById.get(id);
            return fact ? [fact] : [];
        });
        const stagedIds = new Set(staged.map((fact) => fact.id));
        const base = await this.#base.factsById(wanted.filter((id) => !stagedIds.has(id)));
        for (const fact of base)
            this.assertInputNamespace(fact.namespace);
        return [...base, ...staged].sort(byFact);
    }
    async *export(filter = {}) {
        this.assertOpen();
        if (!this.#allowedNamespaces.size)
            return;
        const selected = this.inputFilter(filter);
        const staged = this.#stagedFacts.filter((fact) => matches(fact, selected));
        const base = this.#base.export(selected)[Symbol.asyncIterator]();
        let baseValue = await base.next();
        let stagedIndex = 0;
        try {
            while (!baseValue.done || stagedIndex < staged.length) {
                this.assertOpen();
                const baseFact = baseValue.done ? undefined : baseValue.value;
                const stagedFact = staged[stagedIndex];
                if (!baseFact || (stagedFact && stagedFact.id.localeCompare(baseFact.id) < 0)) {
                    yield stagedFact;
                    stagedIndex++;
                    continue;
                }
                if (stagedFact?.id === baseFact.id) {
                    throw new Error(`Staged portable fact collides with base fact ${baseFact.id}.`);
                }
                this.assertInputNamespace(baseFact.namespace);
                yield baseFact;
                baseValue = await base.next();
            }
        }
        finally {
            await base.return?.();
        }
    }
    async dispose() {
        this.#disposed = true;
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('Staged pass query is disposed.');
    }
    inputFilter(filter) {
        if (filter.namespaces) {
            for (const namespace of filter.namespaces)
                this.assertInputNamespace(namespace);
            return filter;
        }
        return { ...filter, namespaces: [...this.#allowedNamespaces].sort() };
    }
    assertInputNamespace(namespace) {
        if (!this.#allowedNamespaces.has(namespace)) {
            throw new Error(`Portable pass queried undeclared input namespace ${namespace}.`);
        }
    }
}
function mergeCapabilityStatus(base, shards) {
    const values = new Map(base.map((status) => [status.capability, status.completeness]));
    for (const shard of shards) {
        values.set(shard.namespace, combine(values.get(shard.namespace), shard.completion));
        for (const capability of shard.capabilities ?? []) {
            values.set(capability, combine(values.get(capability), shard.completion));
        }
    }
    return [...values]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([capability, completeness]) => ({ capability, completeness }));
}
function combine(left, right) {
    if (!left || left.kind === 'complete')
        return right;
    if (right.kind === 'complete')
        return left;
    if (left.kind === 'unavailable' || right.kind === 'unavailable') {
        return {
            kind: 'unavailable',
            reasons: [
                ...(left.kind === 'unavailable' ? left.reasons : []),
                ...(right.kind === 'unavailable' ? right.reasons : []),
            ],
        };
    }
    return { kind: 'partial', reasons: [...left.reasons, ...right.reasons] };
}
function matches(fact, filter) {
    if (filter.namespaces && !filter.namespaces.includes(fact.namespace))
        return false;
    if (filter.kinds && !filter.kinds.includes(fact.kind))
        return false;
    if (filter.subjects && !filter.subjects.includes(fact.subject))
        return false;
    if (filter.completeness && !filter.completeness.includes(fact.completeness.kind))
        return false;
    if (filter.sources &&
        !fact.provenance.evidence.some((evidence) => filter.sources.includes(evidence.source))) {
        return false;
    }
    if (filter.symbols && !filter.symbols.some((symbol) => fact.subject === symbol))
        return false;
    return true;
}
function matchesHeader(header, filter) {
    if (filter.namespaces && !filter.namespaces.includes(header.namespace))
        return false;
    if (filter.kinds && !filter.kinds.includes(header.kind))
        return false;
    if (filter.subjects && !filter.subjects.includes(header.subject))
        return false;
    if (filter.completeness && !filter.completeness.includes(header.completeness.kind))
        return false;
    if (filter.sources &&
        !header.provenance.evidence.some((evidence) => filter.sources.includes(evidence.source))) {
        return false;
    }
    if (filter.symbols && !filter.symbols.some((symbol) => header.subject === symbol))
        return false;
    return true;
}
function decodeStagedCursor(cursor) {
    if (cursor === undefined)
        return 0;
    const value = Number(cursor);
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Staged fact cursor is invalid.');
    return value;
}
function sameManifest(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function sameReferences(left, right) {
    return (left.length === right.length &&
        left.every((reference, index) => {
            const candidate = right[index];
            return candidate?.key === reference.key && candidate.digest === reference.digest;
        }));
}
function byKey(left, right) {
    return left.key.localeCompare(right.key);
}
function byShard(left, right) {
    return left.key.localeCompare(right.key);
}
function byFact(left, right) {
    return left.id.localeCompare(right.id);
}
function byHeader(left, right) {
    return left.id.localeCompare(right.id);
}
//# sourceMappingURL=runner.js.map
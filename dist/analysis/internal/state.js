import { deriveAnalysisSnapshotSetId } from '../query/identity.js';
import { factHeader, shardReference } from '../facts/index.js';
import { TransactionError, validateFactTransaction } from '../generation/index.js';
import { deriveAnalysisId } from '../identity/index.js';
import { stableJson } from '../identity/model.js';
import { combineCompleteness } from './completeness.js';
import { bindPhysicalFact, immutableFact } from '../facts/representation/index.js';
export function materializeTransaction(current, transaction) {
    const diagnostics = [...validateFactTransaction(transaction, current?.generation.id)];
    const expectedSequence = (current?.generation.sequence ?? 0) + 1;
    if (transaction.next.sequence !== expectedSequence) {
        diagnostics.push(`GENERATION_SEQUENCE_STALE:expected=${expectedSequence}:actual=${transaction.next.sequence}`);
    }
    if (current && current.generation.universe !== transaction.next.universe) {
        diagnostics.push('GENERATION_UNIVERSE_MISMATCH');
    }
    if (diagnostics.length) {
        const code = diagnostics.includes('BASE_STALE') ? 'BASE_STALE' : 'TRANSACTION_ABORTED';
        throw new TransactionError(code, diagnostics.join('\n'));
    }
    const shards = new Map(current?.shards ?? []);
    for (const key of transaction.deletes) {
        if (!shards.delete(key))
            throw new TransactionError('MANIFEST_INVALID', `Unknown delete ${key}.`);
    }
    for (const shard of transaction.upserts)
        shards.set(shard.key, immutable(shard));
    const actual = [...shards.values()].map(shardReference).sort(byKey);
    if (stableJson(actual) !== stableJson(transaction.manifest)) {
        throw new TransactionError('MANIFEST_INVALID', 'The transaction manifest is not the complete materialized next generation.');
    }
    const facts = [...shards.values()].flatMap((shard) => shard.facts);
    const identities = new Set();
    for (const fact of facts) {
        if (identities.has(fact.id)) {
            throw new TransactionError('SHARD_INVALID', `Fact identity ${fact.id} occurs in more than one materialized shard.`);
        }
        identities.add(fact.id);
    }
    for (const fact of facts) {
        for (const input of fact.provenance.inputs) {
            if (!identities.has(input)) {
                throw new TransactionError('SHARD_INVALID', `Fact ${fact.id} names unavailable derivation input ${input}.`);
            }
        }
    }
    // Shard digests deliberately omit the enclosing generation. Preserve the
    // immutable physical shard objects across generations and bind their facts
    // only when a generation-pinned reader observes them. Commit work therefore
    // scales with the delta rather than recreating every unaffected fact.
    return immutable({ generation: transaction.next, shards });
}
export function serializeMaterialized(value) {
    return stableJson({
        generation: value.generation,
        shards: [...value.shards.values()]
            .map((shard) => bindShard(shard, value.generation.id))
            .sort(byShardKey),
    });
}
export function parseMaterialized(value) {
    const parsed = JSON.parse(value);
    if (!parsed ||
        typeof parsed !== 'object' ||
        !parsed.generation ||
        !Array.isArray(parsed.shards)) {
        throw new TypeError('Persisted analysis snapshot has an invalid envelope.');
    }
    const manifest = parsed.shards.map(shardReference).sort(byKey);
    const transaction = {
        protocolVersion: parsed.generation.producer.protocolVersion,
        next: parsed.generation,
        manifest,
        upserts: parsed.shards,
        deletes: [],
    };
    const diagnostics = [...validateFactTransaction(transaction)];
    const identities = new Set();
    for (const shard of parsed.shards) {
        for (const fact of shard.facts) {
            if (identities.has(fact.id))
                diagnostics.push(`FACT_ID_DUPLICATE:${fact.id}`);
            identities.add(fact.id);
        }
    }
    for (const shard of parsed.shards) {
        for (const fact of shard.facts) {
            for (const input of fact.provenance.inputs) {
                if (!identities.has(input))
                    diagnostics.push(`FACT_INPUT_UNAVAILABLE:${fact.id}:${input}`);
            }
        }
    }
    if (diagnostics.length) {
        throw new Error(`Persisted analysis snapshot failed semantic validation: ${[...new Set(diagnostics)].sort().join(', ')}`);
    }
    return immutable({
        generation: parsed.generation,
        shards: new Map(parsed.shards.map((s) => [s.key, s])),
    });
}
export function createQuery(materialized, release) {
    return new PinnedQuery(materialized, release);
}
export function createSnapshotSet(values, inventory, open, release) {
    return new PinnedSnapshotSet(values, inventory, open, release);
}
class PinnedQuery {
    generation;
    #facts;
    #headers;
    #byId;
    #headerById;
    #manifest;
    #shardCompletion;
    #namespaceCapabilities;
    #release;
    #disposed = false;
    constructor(materialized, release) {
        this.#release = release;
        this.generation = materialized.generation;
        this.#facts = [...materialized.shards.values()]
            .flatMap((shard) => shard.facts.map((fact) => bindFact(fact, materialized.generation.id)))
            .sort((left, right) => left.id.localeCompare(right.id));
        this.#headers = this.#facts.map(factHeader);
        this.#byId = new Map(this.#facts.map((fact) => [fact.id, fact]));
        this.#headerById = new Map(this.#headers.map((header) => [header.id, header]));
        this.#manifest = [...materialized.shards.values()].map(shardReference).sort(byKey);
        this.#shardCompletion = [...materialized.shards.values()].map((shard) => [
            shard.namespace,
            shard.completion,
            shard.capabilities ?? [],
        ]);
        const capabilities = new Map();
        for (const shard of materialized.shards.values()) {
            const values = capabilities.get(shard.namespace) ?? new Set();
            for (const capability of shard.capabilities ?? [])
                values.add(capability);
            capabilities.set(shard.namespace, values);
        }
        this.#namespaceCapabilities = new Map([...capabilities].map(([namespace, values]) => [namespace, [...values].sort()]));
    }
    async manifest() {
        this.assertOpen();
        return this.#manifest;
    }
    async capabilities() {
        this.assertOpen();
        const completion = new Map();
        for (const capability of this.generation.capabilities)
            completion.set(capability, { kind: 'complete' });
        for (const [namespace, value, capabilities] of this.#shardCompletion) {
            completion.set(namespace, combineCompleteness(completion.get(namespace), value));
            for (const capability of capabilities) {
                completion.set(capability, combineCompleteness(completion.get(capability), value));
            }
        }
        for (const fact of this.#facts) {
            const current = completion.get(fact.namespace);
            completion.set(fact.namespace, combineCompleteness(current, fact.completeness));
            for (const capability of this.#namespaceCapabilities.get(fact.namespace) ?? []) {
                completion.set(capability, combineCompleteness(completion.get(capability), fact.completeness));
            }
        }
        return [...completion]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([capability, value]) => ({ capability, completeness: value }));
    }
    async headers(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        const limit = page.limit;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
            throw new RangeError('Fact page limit must be an integer from 1 through 10000.');
        }
        const signature = filterSignature(filter);
        const start = page.cursor ? decodeCursor(page.cursor, this.generation.id, signature) : 0;
        const matching = this.#headers.filter((header) => matchesHeader(header, filter));
        const headers = matching.slice(start, start + limit);
        const next = start + headers.length;
        return {
            headers,
            ...(next < matching.length
                ? { nextCursor: encodeCursor(this.generation.id, signature, next) }
                : {}),
            ...(page.includeTotal ? { total: matching.length } : {}),
        };
    }
    async headersById(ids) {
        this.assertOpen();
        return [...new Set(ids)].sort().flatMap((id) => {
            const header = this.#headerById.get(id);
            return header ? [header] : [];
        });
    }
    async *exportHeaders(filter = {}) {
        this.assertOpen();
        for (const header of this.#headers) {
            this.assertOpen();
            if (matchesHeader(header, filter))
                yield header;
        }
    }
    async facts(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        const limit = page.limit;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
            throw new RangeError('Fact page limit must be an integer from 1 through 10000.');
        }
        const signature = filterSignature(filter);
        const start = page.cursor ? decodeCursor(page.cursor, this.generation.id, signature) : 0;
        const matching = this.#facts.filter((fact) => matches(fact, filter));
        const facts = matching.slice(start, start + limit);
        const next = start + facts.length;
        return {
            facts,
            ...(next < matching.length
                ? { nextCursor: encodeCursor(this.generation.id, signature, next) }
                : {}),
            ...(page.includeTotal ? { total: matching.length } : {}),
        };
    }
    async factsById(ids) {
        this.assertOpen();
        return [...new Set(ids)].sort().flatMap((id) => {
            const fact = this.#byId.get(id);
            return fact ? [fact] : [];
        });
    }
    async *export(filter = {}) {
        this.assertOpen();
        for (const fact of this.#facts) {
            this.assertOpen();
            if (matches(fact, filter))
                yield fact;
        }
    }
    async [Symbol.asyncDispose]() {
        await this.dispose();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        await this.#release();
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('Analysis query is disposed.');
    }
}
class PinnedSnapshotSet {
    id;
    inventory;
    generations;
    universes;
    #values;
    #openQuery;
    #release;
    #disposed = false;
    constructor(values, inventory, openQuery, release) {
        this.#values = values;
        this.#openQuery = openQuery;
        this.#release = release;
        this.inventory = inventory;
        this.universes = [...values.keys()].sort();
        this.generations = new Map(this.universes.map((universe) => [universe, values.get(universe).generation.id]));
        this.id = deriveAnalysisSnapshotSetId(this.generations, inventory);
    }
    query(universe) {
        if (this.#disposed)
            throw new Error('Analysis snapshot set is disposed.');
        const value = this.#values.get(universe);
        if (!value)
            throw new Error(`Universe ${universe} is not in this snapshot set.`);
        return this.#openQuery(universe, value.generation.id);
    }
    async [Symbol.asyncDispose]() {
        await this.dispose();
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        await this.#release();
    }
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
function filterSignature(filter) {
    return deriveAnalysisId('fact', 'astrale.analysis.query-filter.v1', filter);
}
function encodeCursor(generation, filter, index) {
    return Buffer.from(stableJson({ generation, filter, index })).toString('base64url');
}
function decodeCursor(cursor, generation, filter) {
    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (decoded.generation !== generation ||
            decoded.filter !== filter ||
            !Number.isSafeInteger(decoded.index) ||
            decoded.index < 0) {
            throw new Error();
        }
        return decoded.index;
    }
    catch {
        throw new Error('Fact cursor is invalid or stale for this generation and filter.');
    }
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    if (value instanceof Map) {
        for (const entry of value.values())
            immutable(entry);
        return Object.freeze(value);
    }
    for (const entry of Object.values(value)) {
        if (isFact(entry))
            immutableFact(entry);
        else
            immutable(entry);
    }
    return Object.freeze(value);
}
function bindShard(shard, generation) {
    if (shard.facts.every((fact) => fact.generation === generation))
        return shard;
    return {
        ...shard,
        facts: shard.facts.map((fact) => bindFact(fact, generation)),
    };
}
function bindFact(fact, generation) {
    return bindPhysicalFact(fact, generation);
}
function isFact(value) {
    return Boolean(value &&
        typeof value === 'object' &&
        typeof value.id === 'string' &&
        typeof value.namespace === 'string' &&
        typeof value.generation === 'string' &&
        Object.hasOwn(value, 'payload'));
}
function byKey(left, right) {
    return left.key.localeCompare(right.key);
}
function byShardKey(left, right) {
    return left.key.localeCompare(right.key);
}
//# sourceMappingURL=state.js.map
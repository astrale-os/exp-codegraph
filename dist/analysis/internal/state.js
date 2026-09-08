import { deriveAnalysisSnapshotSetId } from '../query/identity.js';
import { factHeader, shardReference } from '../facts/index.js';
import { TransactionError, validateFactTransaction } from '../generation/index.js';
import { deriveAnalysisId } from '../identity/index.js';
import { stableJson } from '../identity/model.js';
import { MemoryFactIndex } from './query-index.js';
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
    const inherited = current instanceof MaterializedSnapshot ? current.indexedFacts() : undefined;
    const removed = inherited ? [...new Set([...transaction.deletes, ...transaction.upserts.map((shard) => shard.key)])]
        .flatMap((key) => { const shard = current.shards.get(key); return shard ? [shard] : []; }) : [];
    return immutable(new MaterializedSnapshot(transaction.next, shards, inherited?.update(removed, transaction.upserts)));
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
    return immutable(new MaterializedSnapshot(parsed.generation, new Map(parsed.shards.map((s) => [s.key, s]))));
}
export function createQuery(materialized, release) {
    return new PinnedQuery(materialized, release);
}
export function createSnapshotSet(values, inventory, open, release) {
    return new PinnedSnapshotSet(values, inventory, open, release);
}
/** Query indexes belong to the retained generation, never to a process-global cache. */
class MaterializedSnapshot {
    #index;
    #facts;
    generation;
    shards;
    constructor(generation, shards, facts) {
        this.#facts = facts;
        this.generation = generation;
        this.shards = shards;
    }
    queryIndex() {
        return this.#index ??= new MemoryQueryIndex(this, this.#facts ??= MemoryFactIndex.build(this.shards));
    }
    indexedFacts() { return this.#facts; }
}
class MemoryQueryIndex {
    generation;
    #data;
    #facts = new Map();
    #headers = new Map();
    #capabilities;
    constructor(materialized, data = MemoryFactIndex.build(materialized.shards)) {
        this.generation = materialized.generation;
        this.#data = data;
    }
    get manifest() { return this.#data.manifest(); }
    fact(input) {
        const id = typeof input === 'string' ? input : input.id;
        let value = this.#facts.get(id);
        if (!value) {
            const fact = typeof input === 'string' ? this.#data.facts.get(id) : input;
            if (!fact)
                return;
            value = immutableFact(bindFact(fact, this.generation.id));
            this.#facts.set(id, value);
        }
        return value;
    }
    header(input) {
        const id = typeof input === 'string' ? input : input.id;
        let value = this.#headers.get(id);
        if (!value) {
            const fact = typeof input === 'string' ? this.#data.facts.get(id) : input;
            if (!fact)
                return;
            value = Object.freeze({ ...factHeader(fact), generation: this.generation.id });
            this.#headers.set(id, value);
        }
        return value;
    }
    capabilities() {
        return this.#capabilities ??= immutable(this.#data.capabilities(this.generation.capabilities));
    }
    matching(filter) { return this.#data.matching(filter); }
    page(filter, page) {
        const limit = page.limit;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
            throw new RangeError('Fact page limit must be an integer from 1 through 10000.');
        }
        const signature = filterSignature(filter);
        const start = page.cursor ? decodeCursor(page.cursor, this.generation.id, signature) : 0;
        const headers = [];
        let total = 0;
        let hasNext = false;
        for (const fact of this.matching(filter)) {
            const position = total++;
            if (position < start)
                continue;
            if (headers.length < limit)
                headers.push(this.header(fact));
            else {
                hasNext = true;
                if (!page.includeTotal)
                    break;
            }
        }
        return {
            headers,
            ...(hasNext ? { nextCursor: encodeCursor(this.generation.id, signature, start + headers.length) } : {}),
            ...(page.includeTotal ? { total } : {}),
        };
    }
}
class PinnedQuery {
    generation;
    #index;
    #release;
    #disposed = false;
    constructor(materialized, release) {
        this.generation = materialized.generation;
        this.#release = release;
        this.#index = materialized instanceof MaterializedSnapshot
            ? materialized.queryIndex()
            : new MemoryQueryIndex(materialized);
    }
    async manifest() {
        this.assertOpen();
        return this.#index.manifest;
    }
    async capabilities() {
        this.assertOpen();
        return this.#index.capabilities();
    }
    async headers(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        return this.#index.page(filter, page);
    }
    async headersById(ids) {
        this.assertOpen();
        return [...new Set(ids)].sort().flatMap((id) => {
            const header = this.#index.header(id);
            return header ? [header] : [];
        });
    }
    async *exportHeaders(filter = {}) {
        this.assertOpen();
        for (const header of this.#index.matching(filter)) {
            this.assertOpen();
            yield this.#index.header(header);
        }
    }
    async facts(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        const result = this.#index.page(filter, page);
        return {
            facts: result.headers.map((header) => this.#index.fact(header.id)),
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
            ...(result.total !== undefined ? { total: result.total } : {}),
        };
    }
    async factsById(ids) {
        this.assertOpen();
        return [...new Set(ids)].sort().flatMap((id) => {
            const fact = this.#index.fact(id);
            return fact ? [fact] : [];
        });
    }
    async *export(filter = {}) {
        this.assertOpen();
        for (const header of this.#index.matching(filter)) {
            this.assertOpen();
            yield this.#index.fact(header);
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
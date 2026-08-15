import { combineCompleteness } from '../../internal/completeness.js';
import { factFromRows, factHeaderFromRows, parseCapabilities, parseJson, } from '../materialization/model.js';
import { loadManifest } from '../materialization/read.js';
import { loadShardPayloads, persistedFactPayload, ShardPayloadCache, } from '../materialization/payload.js';
import { decodeSQLiteCursor, encodeSQLiteCursor } from './cursor.js';
import { buildSQLiteFactFilter } from './filter.js';
export class SQLitePinnedQuery {
    #disposed = false;
    #database;
    #storeNamespace;
    generation;
    #release;
    #payloadCodecs;
    #payloads;
    #maximumDecompressedShardPayloadBytes;
    constructor(database, storeNamespace, generation, payloadCodecs, maximumDecompressedShardPayloadBytes, maximumCachedShardPayloadBytes, release) {
        this.#database = database;
        this.#storeNamespace = storeNamespace;
        this.generation = generation;
        this.#payloadCodecs = payloadCodecs;
        this.#maximumDecompressedShardPayloadBytes = maximumDecompressedShardPayloadBytes;
        this.#payloads = new ShardPayloadCache(maximumCachedShardPayloadBytes);
        this.#release = release;
    }
    async manifest() {
        this.assertOpen();
        return loadManifest(this.#database, this.#storeNamespace, this.generation.universe, this.generation.sequence);
    }
    async capabilities() {
        this.assertOpen();
        const completion = new Map();
        for (const capability of this.generation.capabilities) {
            completion.set(capability, { kind: 'complete' });
        }
        const shards = this.#database
            .prepare(`SELECT shard.fact_namespace, shard.completion_json, shard.capabilities_json
         FROM analysis_generation_shards AS member
         JOIN analysis_shards AS shard
           ON shard.store_namespace = member.store_namespace
          AND shard.shard_digest = member.shard_digest
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?`)
            .all(this.#storeNamespace, this.generation.universe, this.generation.sequence);
        const namespaceCapabilities = new Map();
        for (const row of shards) {
            const value = parseJson(row.completion_json, 'shard completeness');
            completion.set(row.fact_namespace, combineCompleteness(completion.get(row.fact_namespace), value));
            const mapped = namespaceCapabilities.get(row.fact_namespace) ?? new Set();
            for (const capability of parseCapabilities(row.capabilities_json, 'shard capabilities')) {
                mapped.add(capability);
                completion.set(capability, combineCompleteness(completion.get(capability), value));
            }
            namespaceCapabilities.set(row.fact_namespace, mapped);
        }
        const facts = this.#database
            .prepare(`SELECT fact.fact_namespace, fact.completeness_json
         FROM analysis_generation_shards AS member
         JOIN analysis_facts AS fact
           ON fact.store_namespace = member.store_namespace
          AND fact.shard_digest = member.shard_digest
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?`)
            .all(this.#storeNamespace, this.generation.universe, this.generation.sequence);
        for (const row of facts) {
            const value = parseJson(row.completeness_json, 'fact completeness');
            completion.set(row.fact_namespace, combineCompleteness(completion.get(row.fact_namespace), value));
            for (const capability of namespaceCapabilities.get(row.fact_namespace) ?? []) {
                completion.set(capability, combineCompleteness(completion.get(capability), value));
            }
        }
        return [...completion]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([capability, completeness]) => ({ capability, completeness }));
    }
    async headers(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        validatePageLimit(page.limit);
        const selected = buildSQLiteFactFilter(filter);
        const lastFact = page.cursor
            ? decodeSQLiteCursor(page.cursor, this.generation.id, filter)
            : undefined;
        const baseParameters = [
            this.#storeNamespace,
            this.generation.universe,
            this.generation.sequence,
            ...selected.parameters,
        ];
        const total = page.includeTotal
            ? this.countFacts(selected.sql, baseParameters)
            : undefined;
        const rows = this.#database
            .prepare(`${factHeaderSelectionSql()}
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?
           ${selected.sql}
           ${lastFact ? 'AND fact.fact_id > ?' : ''}
         ORDER BY fact.fact_id
         LIMIT ?`)
            .all(...baseParameters, ...(lastFact ? [lastFact] : []), page.limit + 1);
        const hasNext = rows.length > page.limit;
        if (hasNext)
            rows.pop();
        const headers = rows.map((row) => this.decodeHeader(row));
        return {
            headers,
            ...(hasNext && headers.length
                ? { nextCursor: encodeSQLiteCursor(this.generation.id, filter, headers.at(-1).id) }
                : {}),
            ...(total === undefined ? {} : { total }),
        };
    }
    async headersById(ids) {
        this.assertOpen();
        const unique = [...new Set(ids)].sort();
        if (!unique.length)
            return [];
        const results = [];
        for (let start = 0; start < unique.length; start += 500) {
            const chunk = unique.slice(start, start + 500);
            const rows = this.#database
                .prepare(`${factHeaderSelectionSql()}
           WHERE member.store_namespace = ?
             AND member.universe = ?
             AND member.generation_sequence = ?
             AND fact.fact_id IN (${chunk.map(() => '?').join(', ')})
           ORDER BY fact.fact_id`)
                .all(this.#storeNamespace, this.generation.universe, this.generation.sequence, ...chunk);
            results.push(...rows.map((row) => this.decodeHeader(row)));
        }
        return results.sort((left, right) => left.id.localeCompare(right.id));
    }
    async *exportHeaders(filter = {}) {
        this.assertOpen();
        let cursor;
        do {
            this.assertOpen();
            const page = await this.headers(filter, { limit: 1_000, ...(cursor ? { cursor } : {}) });
            for (const header of page.headers) {
                this.assertOpen();
                yield header;
            }
            cursor = page.nextCursor;
        } while (cursor);
    }
    async facts(filter = {}, page = { limit: 100 }) {
        this.assertOpen();
        validatePageLimit(page.limit);
        const selected = buildSQLiteFactFilter(filter);
        const lastFact = page.cursor
            ? decodeSQLiteCursor(page.cursor, this.generation.id, filter)
            : undefined;
        const baseParameters = [
            this.#storeNamespace,
            this.generation.universe,
            this.generation.sequence,
            ...selected.parameters,
        ];
        const total = page.includeTotal
            ? this.countFacts(selected.sql, baseParameters)
            : undefined;
        const rows = this.#database
            .prepare(`${factSelectionSql()}
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?
           ${selected.sql}
           ${lastFact ? 'AND fact.fact_id > ?' : ''}
         ORDER BY fact.fact_id
         LIMIT ?`)
            .all(...baseParameters, ...(lastFact ? [lastFact] : []), page.limit + 1);
        const hasNext = rows.length > page.limit;
        if (hasNext)
            rows.pop();
        const facts = rows.map((row) => this.decodeFact(row));
        return {
            facts,
            ...(hasNext && facts.length
                ? {
                    nextCursor: encodeSQLiteCursor(this.generation.id, filter, facts.at(-1).id),
                }
                : {}),
            ...(total === undefined ? {} : { total }),
        };
    }
    async factsById(ids) {
        this.assertOpen();
        const unique = [...new Set(ids)].sort();
        if (!unique.length)
            return [];
        const results = [];
        for (let start = 0; start < unique.length; start += 500) {
            const chunk = unique.slice(start, start + 500);
            const rows = this.#database
                .prepare(`${factSelectionSql()}
           WHERE member.store_namespace = ?
             AND member.universe = ?
             AND member.generation_sequence = ?
             AND fact.fact_id IN (${chunk.map(() => '?').join(', ')})
           ORDER BY fact.fact_id`)
                .all(this.#storeNamespace, this.generation.universe, this.generation.sequence, ...chunk);
            results.push(...rows.map((row) => this.decodeFact(row)));
        }
        return results.sort((left, right) => left.id.localeCompare(right.id));
    }
    async *export(filter = {}) {
        this.assertOpen();
        let cursor;
        do {
            this.assertOpen();
            const page = await this.facts(filter, { limit: 1_000, ...(cursor ? { cursor } : {}) });
            for (const fact of page.facts) {
                this.assertOpen();
                yield fact;
            }
            cursor = page.nextCursor;
        } while (cursor);
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
    decodeFact(row) {
        // Decode each shard immediately before consuming one of its rows. A bounded
        // cache may evict earlier shards; bulk-prefetching a page would therefore
        // make correctness depend on the page's aggregate decompressed size.
        loadShardPayloads(this.#database, this.#storeNamespace, [row], this.#payloads, this.#maximumDecompressedShardPayloadBytes);
        const evidence = parseJson(row.evidence_json, `fact ${row.fact_id} evidence`);
        const inputs = parseJson(row.inputs_json, `fact ${row.fact_id} inputs`);
        if (!Array.isArray(evidence) || !Array.isArray(inputs)) {
            throw new TypeError(`Persisted fact ${row.fact_id} provenance is invalid.`);
        }
        return factFromRows(row, this.generation.id, evidence, inputs, persistedFactPayload(row, this.#payloads), this.#payloadCodecs);
    }
    decodeHeader(row) {
        const evidence = parseJson(row.evidence_json, `fact ${row.fact_id} evidence`);
        const inputs = parseJson(row.inputs_json, `fact ${row.fact_id} inputs`);
        if (!Array.isArray(evidence) || !Array.isArray(inputs)) {
            throw new TypeError(`Persisted fact ${row.fact_id} provenance is invalid.`);
        }
        return factHeaderFromRows(row, this.generation.id, evidence, inputs);
    }
    countFacts(sql, parameters) {
        return this.#database
            .prepare(`SELECT COUNT(*) AS count
           FROM analysis_generation_shards AS member
           JOIN analysis_facts AS fact
             ON fact.store_namespace = member.store_namespace
            AND fact.shard_digest = member.shard_digest
           WHERE member.store_namespace = ?
             AND member.universe = ?
             AND member.generation_sequence = ?
             ${sql}`)
            .get(...parameters).count;
    }
    assertOpen() {
        if (this.#disposed)
            throw new Error('Analysis query is disposed.');
    }
}
function factSelectionSql() {
    return factEnvelopeSelectionSql('fact.*, shard.payload_layout', true);
}
function factHeaderSelectionSql() {
    return factEnvelopeSelectionSql(`fact.shard_digest, fact.fact_id, fact.fact_namespace, fact.schema_version,
     fact.kind, fact.subject, fact.completeness_kind, fact.completeness_json,
     fact.pass_id, fact.pass_version`, false);
}
function factEnvelopeSelectionSql(columns, includeShard) {
    return `SELECT ${columns},
    COALESCE((
      SELECT json_group_array(json_object(
        'shard_digest', ordered.shard_digest,
        'fact_id', ordered.fact_id,
        'ordinal', ordered.ordinal,
        'source_id', ordered.source_id,
        'source_revision', ordered.source_revision,
        'start_offset', ordered.start_offset,
        'end_offset', ordered.end_offset
      ))
      FROM (
        SELECT evidence.*
        FROM analysis_fact_evidence AS evidence
        WHERE evidence.store_namespace = fact.store_namespace
          AND evidence.shard_digest = fact.shard_digest
          AND evidence.fact_id = fact.fact_id
        ORDER BY evidence.ordinal
      ) AS ordered
    ), '[]') AS evidence_json,
    COALESCE((
      SELECT json_group_array(json_object(
        'shard_digest', ordered.shard_digest,
        'fact_id', ordered.fact_id,
        'ordinal', ordered.ordinal,
        'input_fact_id', ordered.input_fact_id
      ))
      FROM (
        SELECT input.*
        FROM analysis_fact_inputs AS input
        WHERE input.store_namespace = fact.store_namespace
          AND input.shard_digest = fact.shard_digest
          AND input.fact_id = fact.fact_id
        ORDER BY input.ordinal
      ) AS ordered
    ), '[]') AS inputs_json
  FROM analysis_generation_shards AS member
  JOIN analysis_facts AS fact
    ON fact.store_namespace = member.store_namespace
   AND fact.shard_digest = member.shard_digest
  ${includeShard ? `JOIN analysis_shards AS shard
    ON shard.store_namespace = fact.store_namespace
   AND shard.shard_digest = fact.shard_digest` : ''}`;
}
function validatePageLimit(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new RangeError('Fact page limit must be an integer from 1 through 10000.');
    }
}
//# sourceMappingURL=pinned.js.map
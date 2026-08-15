import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gunzipSync, } from 'node:zlib';
import { admitStoredFactPayload, payloadForSemanticIdentity, payloadForStorage, } from '../../facts/representation/index.js';
import { encodeJson, parseJson } from './model.js';
export const SQLITE_INLINE_PAYLOAD_LAYOUT = 'inline-json/1';
export const SQLITE_SHARD_PAYLOAD_LAYOUT = 'shard-ordinal/1';
export const SQLITE_SHARD_PAYLOAD_ENCODING = 'brotli-stored-payloads/2';
const LEGACY_BROTLI_ENCODING = 'brotli-json/1';
const LEGACY_GZIP_ENCODING = 'gzip-json/1';
export class ShardPayloadCache {
    #maximumBytes;
    #entries = new Map();
    #bytes = 0;
    constructor(maximumBytes) {
        this.#maximumBytes = maximumBytes;
    }
    has(digest) {
        return this.#entries.has(digest);
    }
    get(digest) {
        const value = this.#entries.get(digest);
        if (!this.#entries.has(digest))
            return undefined;
        this.#entries.delete(digest);
        this.#entries.set(digest, value);
        return value;
    }
    set(digest, value) {
        const prior = this.#entries.get(digest);
        if (prior)
            this.#bytes -= prior.bytes;
        this.#entries.delete(digest);
        const bytes = value?.bytes ?? 0;
        while (this.#entries.size && this.#bytes + bytes > this.#maximumBytes) {
            const oldest = this.#entries.entries().next().value;
            if (!oldest)
                break;
            this.#entries.delete(oldest[0]);
            this.#bytes -= oldest[1]?.bytes ?? 0;
        }
        if (bytes > this.#maximumBytes) {
            throw new RangeError(`Decoded shard ${digest} exceeds the configured payload cache.`);
        }
        this.#entries.set(digest, value);
        this.#bytes += bytes;
    }
}
export function encodeShardPayloads(facts, maximumDecompressedBytes) {
    const semantic = Buffer.from(encodeJson(facts.map(payloadForStorage)));
    if (semantic.byteLength > maximumDecompressedBytes) {
        throw new RangeError(`Shard payload exceeds the configured decompressed limit: bytes=${semantic.byteLength} limit=${maximumDecompressedBytes}.`);
    }
    return {
        layout: SQLITE_SHARD_PAYLOAD_LAYOUT,
        encoding: SQLITE_SHARD_PAYLOAD_ENCODING,
        payloads: brotliCompressSync(semantic, {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
        }),
        decompressedBytes: semantic.byteLength,
    };
}
export function prepareShardPayloads(shards, maximumDecompressedBytes, materialization) {
    return new Map(shards.map((shard) => [
        shard.digest,
        materialization === 'shard-brotli'
            ? encodeShardPayloads(shard.facts, maximumDecompressedBytes)
            : encodeInlinePayloads(shard.facts, maximumDecompressedBytes),
    ]));
}
function encodeInlinePayloads(facts, maximumDecompressedBytes) {
    const payloads = facts.map((fact) => encodeJson(payloadForSemanticIdentity(fact)));
    const decompressedBytes = Buffer.byteLength(`[${payloads.join(',')}]`);
    if (decompressedBytes > maximumDecompressedBytes) {
        throw new RangeError(`Shard payload exceeds the configured decompressed limit: bytes=${decompressedBytes} limit=${maximumDecompressedBytes}.`);
    }
    return {
        layout: SQLITE_INLINE_PAYLOAD_LAYOUT,
        payloads,
        decompressedBytes,
    };
}
export function loadShardPayloads(database, storeNamespace, rows, cache, maximumDecompressedBytes) {
    const missing = [
        ...new Set(rows
            .filter((row) => row.payload_layout === SQLITE_SHARD_PAYLOAD_LAYOUT)
            .map((row) => row.shard_digest)
            .filter((digest) => !cache.has(digest))),
    ].sort();
    for (let start = 0; start < missing.length; start += 500) {
        const chunk = missing.slice(start, start + 500);
        const selected = database
            .prepare(`SELECT shard_digest, encoding, payloads_blob
         FROM analysis_shard_payloads
         WHERE store_namespace = ?
           AND shard_digest IN (${chunk.map(() => '?').join(', ')})`)
            .all(storeNamespace, ...chunk);
        const byDigest = new Map(selected.map((row) => [row.shard_digest, row]));
        for (const digest of chunk) {
            const row = byDigest.get(digest);
            cache.set(digest, row ? decodeShardPayloads(row, maximumDecompressedBytes) : undefined);
        }
    }
}
export function persistedFactPayload(row, cache) {
    if (row.payload_layout === SQLITE_INLINE_PAYLOAD_LAYOUT) {
        return {
            kind: 'semantic',
            value: parseJson(row.payload_json, `fact ${row.fact_id} payload`),
        };
    }
    if (row.payload_layout !== SQLITE_SHARD_PAYLOAD_LAYOUT) {
        throw new TypeError(`Persisted fact ${row.fact_id} payload layout is unsupported.`);
    }
    const decoded = cache.get(row.shard_digest);
    if (!decoded)
        throw new TypeError(`Persisted shard ${row.shard_digest} payload storage is missing.`);
    const ordinal = parseJson(row.payload_json, `fact ${row.fact_id} payload ordinal`);
    if (!Number.isSafeInteger(ordinal) || Number(ordinal) < 0 || Number(ordinal) >= decoded.payloads.length) {
        throw new TypeError(`Persisted fact ${row.fact_id} payload ordinal is invalid.`);
    }
    const value = decoded.payloads[Number(ordinal)];
    return decoded.storedRecords
        ? admitStoredFactPayload(value, `fact ${row.fact_id} stored payload`)
        : { kind: 'semantic', value };
}
/** Verify that one compact shard blob owns exactly one payload per fact row. */
export function validateShardPayloadMembership(rows, cache) {
    if (!rows.length)
        return;
    const layout = rows[0].payload_layout;
    if (rows.some((row) => row.payload_layout !== layout)) {
        throw new TypeError(`Persisted shard ${rows[0].shard_digest} mixes payload layouts.`);
    }
    if (layout === SQLITE_INLINE_PAYLOAD_LAYOUT)
        return;
    if (layout !== SQLITE_SHARD_PAYLOAD_LAYOUT) {
        throw new TypeError(`Persisted shard ${rows[0].shard_digest} payload layout is unsupported.`);
    }
    const decoded = cache.get(rows[0].shard_digest);
    if (!decoded)
        throw new TypeError(`Persisted shard ${rows[0].shard_digest} payload storage is missing.`);
    if (decoded.payloads.length !== rows.length) {
        throw new TypeError(`Persisted shard ${rows[0].shard_digest} payload count is invalid.`);
    }
    const ordinals = rows.map((row) => {
        const value = parseJson(row.payload_json, `fact ${row.fact_id} payload ordinal`);
        if (!Number.isSafeInteger(value)) {
            throw new TypeError(`Persisted fact ${row.fact_id} payload ordinal is invalid.`);
        }
        return Number(value);
    }).sort((left, right) => left - right);
    if (ordinals.some((ordinal, index) => ordinal !== index)) {
        throw new TypeError(`Persisted shard ${rows[0].shard_digest} payload ordinals are invalid.`);
    }
}
export function decodeShardPayloads(row, maximumDecompressedBytes) {
    let decoded;
    try {
        const options = { maxOutputLength: maximumDecompressedBytes };
        if (row.encoding === SQLITE_SHARD_PAYLOAD_ENCODING || row.encoding === LEGACY_BROTLI_ENCODING) {
            decoded = brotliDecompressSync(Buffer.from(row.payloads_blob), options);
        }
        else if (row.encoding === LEGACY_GZIP_ENCODING) {
            decoded = gunzipSync(Buffer.from(row.payloads_blob), options);
        }
        else {
            throw new TypeError(`Persisted shard payload encoding ${row.encoding} is unsupported.`);
        }
    }
    catch (error) {
        throw new TypeError(`Persisted shard ${row.shard_digest} payload is corrupt or exceeds its limit.`, {
            cause: error,
        });
    }
    if (decoded.byteLength > maximumDecompressedBytes) {
        throw new RangeError(`Persisted shard ${row.shard_digest} payload exceeds its limit.`);
    }
    const payloads = parseJson(Buffer.from(decoded).toString('utf8'), `shard ${row.shard_digest} payloads`);
    if (!Array.isArray(payloads)) {
        throw new TypeError(`Persisted shard ${row.shard_digest} payloads are invalid.`);
    }
    return {
        payloads,
        bytes: decoded.byteLength,
        storedRecords: row.encoding === SQLITE_SHARD_PAYLOAD_ENCODING,
    };
}
//# sourceMappingURL=payload.js.map
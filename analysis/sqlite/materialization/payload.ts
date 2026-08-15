import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  gunzipSync,
} from 'node:zlib'
import type { DatabaseSync } from 'node:sqlite'

import type { Fact } from '../../facts/index.ts'
import {
  admitStoredFactPayload,
  payloadForSemanticIdentity,
  payloadForStorage,
  type StoredFactPayload,
} from '../../facts/representation/index.ts'
import type { SQLitePayloadMaterialization } from '../limits.ts'
import { encodeJson, parseJson, type FactRow } from './model.ts'

export const SQLITE_INLINE_PAYLOAD_LAYOUT = 'inline-json/1'
export const SQLITE_SHARD_PAYLOAD_LAYOUT = 'shard-ordinal/1'
export const SQLITE_SHARD_PAYLOAD_ENCODING = 'brotli-stored-payloads/2'
const LEGACY_BROTLI_ENCODING = 'brotli-json/1'
const LEGACY_GZIP_ENCODING = 'gzip-json/1'

export interface ShardPayloadRow {
  readonly shard_digest: string
  readonly encoding: string
  readonly payloads_blob: Uint8Array
}

export type PreparedShardPayload =
  | {
      readonly layout: typeof SQLITE_SHARD_PAYLOAD_LAYOUT
      readonly encoding: string
      readonly payloads: Uint8Array
      readonly decompressedBytes: number
    }
  | {
      readonly layout: typeof SQLITE_INLINE_PAYLOAD_LAYOUT
      readonly payloads: readonly string[]
      readonly decompressedBytes: number
    }

interface DecodedShardPayloads {
  readonly payloads: readonly unknown[]
  readonly bytes: number
  readonly storedRecords: boolean
}

type PayloadFactRow = Pick<FactRow, 'fact_id' | 'shard_digest' | 'payload_json'> & {
  readonly payload_layout: string
}

export class ShardPayloadCache {
  readonly #maximumBytes: number
  readonly #entries = new Map<string, DecodedShardPayloads | undefined>()
  #bytes = 0

  constructor(maximumBytes: number) {
    this.#maximumBytes = maximumBytes
  }

  has(digest: string): boolean {
    return this.#entries.has(digest)
  }

  get(digest: string): DecodedShardPayloads | undefined {
    const value = this.#entries.get(digest)
    if (!this.#entries.has(digest)) return undefined
    this.#entries.delete(digest)
    this.#entries.set(digest, value)
    return value
  }

  set(digest: string, value: DecodedShardPayloads | undefined): void {
    const prior = this.#entries.get(digest)
    if (prior) this.#bytes -= prior.bytes
    this.#entries.delete(digest)
    const bytes = value?.bytes ?? 0
    while (this.#entries.size && this.#bytes + bytes > this.#maximumBytes) {
      const oldest = this.#entries.entries().next().value as
        | [string, DecodedShardPayloads | undefined]
        | undefined
      if (!oldest) break
      this.#entries.delete(oldest[0])
      this.#bytes -= oldest[1]?.bytes ?? 0
    }
    if (bytes > this.#maximumBytes) {
      throw new RangeError(`Decoded shard ${digest} exceeds the configured payload cache.`)
    }
    this.#entries.set(digest, value)
    this.#bytes += bytes
  }
}

export function encodeShardPayloads(
  facts: readonly Fact[],
  maximumDecompressedBytes: number,
): Extract<PreparedShardPayload, { readonly layout: typeof SQLITE_SHARD_PAYLOAD_LAYOUT }> {
  const semantic = Buffer.from(encodeJson(facts.map(payloadForStorage)))
  if (semantic.byteLength > maximumDecompressedBytes) {
    throw new RangeError(
      `Shard payload exceeds the configured decompressed limit: bytes=${semantic.byteLength} limit=${maximumDecompressedBytes}.`,
    )
  }
  return {
    layout: SQLITE_SHARD_PAYLOAD_LAYOUT,
    encoding: SQLITE_SHARD_PAYLOAD_ENCODING,
    payloads: brotliCompressSync(semantic, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    }),
    decompressedBytes: semantic.byteLength,
  }
}

export function prepareShardPayloads(
  shards: readonly { readonly digest: string; readonly facts: readonly Fact[] }[],
  maximumDecompressedBytes: number,
  materialization: SQLitePayloadMaterialization,
): ReadonlyMap<string, PreparedShardPayload> {
  return new Map(
    shards.map((shard) => [
      shard.digest,
      materialization === 'shard-brotli'
        ? encodeShardPayloads(shard.facts, maximumDecompressedBytes)
        : encodeInlinePayloads(shard.facts, maximumDecompressedBytes),
    ]),
  )
}

function encodeInlinePayloads(
  facts: readonly Fact[],
  maximumDecompressedBytes: number,
): PreparedShardPayload {
  const payloads = facts.map((fact) => encodeJson(payloadForSemanticIdentity(fact)))
  const decompressedBytes = Buffer.byteLength(`[${payloads.join(',')}]`)
  if (decompressedBytes > maximumDecompressedBytes) {
    throw new RangeError(
      `Shard payload exceeds the configured decompressed limit: bytes=${decompressedBytes} limit=${maximumDecompressedBytes}.`,
    )
  }
  return {
    layout: SQLITE_INLINE_PAYLOAD_LAYOUT,
    payloads,
    decompressedBytes,
  }
}

export function loadShardPayloads(
  database: DatabaseSync,
  storeNamespace: string,
  rows: readonly PayloadFactRow[],
  cache: ShardPayloadCache,
  maximumDecompressedBytes: number,
): void {
  const missing = [
    ...new Set(
      rows
        .filter((row) => row.payload_layout === SQLITE_SHARD_PAYLOAD_LAYOUT)
        .map((row) => row.shard_digest)
        .filter((digest) => !cache.has(digest)),
    ),
  ].sort()
  for (let start = 0; start < missing.length; start += 500) {
    const chunk = missing.slice(start, start + 500)
    const selected = database
      .prepare(
        `SELECT shard_digest, encoding, payloads_blob
         FROM analysis_shard_payloads
         WHERE store_namespace = ?
           AND shard_digest IN (${chunk.map(() => '?').join(', ')})`,
      )
      .all(storeNamespace, ...chunk) as unknown as ShardPayloadRow[]
    const byDigest = new Map(selected.map((row) => [row.shard_digest, row]))
    for (const digest of chunk) {
      const row = byDigest.get(digest)
      cache.set(
        digest,
        row ? decodeShardPayloads(row, maximumDecompressedBytes) : undefined,
      )
    }
  }
}

export function persistedFactPayload(
  row: PayloadFactRow,
  cache: ShardPayloadCache,
): StoredFactPayload {
  if (row.payload_layout === SQLITE_INLINE_PAYLOAD_LAYOUT) {
    return {
      kind: 'semantic',
      value: parseJson(row.payload_json, `fact ${row.fact_id} payload`),
    }
  }
  if (row.payload_layout !== SQLITE_SHARD_PAYLOAD_LAYOUT) {
    throw new TypeError(`Persisted fact ${row.fact_id} payload layout is unsupported.`)
  }
  const decoded = cache.get(row.shard_digest)
  if (!decoded) throw new TypeError(`Persisted shard ${row.shard_digest} payload storage is missing.`)
  const ordinal = parseJson(row.payload_json, `fact ${row.fact_id} payload ordinal`)
  if (!Number.isSafeInteger(ordinal) || Number(ordinal) < 0 || Number(ordinal) >= decoded.payloads.length) {
    throw new TypeError(`Persisted fact ${row.fact_id} payload ordinal is invalid.`)
  }
  const value = decoded.payloads[Number(ordinal)]
  return decoded.storedRecords
    ? admitStoredFactPayload(value, `fact ${row.fact_id} stored payload`)
    : { kind: 'semantic', value }
}

/** Verify that one compact shard blob owns exactly one payload per fact row. */
export function validateShardPayloadMembership(
  rows: readonly PayloadFactRow[],
  cache: ShardPayloadCache,
): void {
  if (!rows.length) return
  const layout = rows[0]!.payload_layout
  if (rows.some((row) => row.payload_layout !== layout)) {
    throw new TypeError(`Persisted shard ${rows[0]!.shard_digest} mixes payload layouts.`)
  }
  if (layout === SQLITE_INLINE_PAYLOAD_LAYOUT) return
  if (layout !== SQLITE_SHARD_PAYLOAD_LAYOUT) {
    throw new TypeError(`Persisted shard ${rows[0]!.shard_digest} payload layout is unsupported.`)
  }
  const decoded = cache.get(rows[0]!.shard_digest)
  if (!decoded) throw new TypeError(`Persisted shard ${rows[0]!.shard_digest} payload storage is missing.`)
  if (decoded.payloads.length !== rows.length) {
    throw new TypeError(`Persisted shard ${rows[0]!.shard_digest} payload count is invalid.`)
  }
  const ordinals = rows.map((row) => {
    const value = parseJson(row.payload_json, `fact ${row.fact_id} payload ordinal`)
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Persisted fact ${row.fact_id} payload ordinal is invalid.`)
    }
    return Number(value)
  }).sort((left, right) => left - right)
  if (ordinals.some((ordinal, index) => ordinal !== index)) {
    throw new TypeError(`Persisted shard ${rows[0]!.shard_digest} payload ordinals are invalid.`)
  }
}

export function decodeShardPayloads(
  row: ShardPayloadRow,
  maximumDecompressedBytes: number,
): DecodedShardPayloads {
  let decoded: Uint8Array
  try {
    const options = { maxOutputLength: maximumDecompressedBytes }
    if (row.encoding === SQLITE_SHARD_PAYLOAD_ENCODING || row.encoding === LEGACY_BROTLI_ENCODING) {
      decoded = brotliDecompressSync(Buffer.from(row.payloads_blob), options)
    } else if (row.encoding === LEGACY_GZIP_ENCODING) {
      decoded = gunzipSync(Buffer.from(row.payloads_blob), options)
    } else {
      throw new TypeError(`Persisted shard payload encoding ${row.encoding} is unsupported.`)
    }
  } catch (error) {
    throw new TypeError(`Persisted shard ${row.shard_digest} payload is corrupt or exceeds its limit.`, {
      cause: error,
    })
  }
  if (decoded.byteLength > maximumDecompressedBytes) {
    throw new RangeError(`Persisted shard ${row.shard_digest} payload exceeds its limit.`)
  }
  const payloads = parseJson(
    Buffer.from(decoded).toString('utf8'),
    `shard ${row.shard_digest} payloads`,
  )
  if (!Array.isArray(payloads)) {
    throw new TypeError(`Persisted shard ${row.shard_digest} payloads are invalid.`)
  }
  return {
    payloads,
    bytes: decoded.byteLength,
    storedRecords: row.encoding === SQLITE_SHARD_PAYLOAD_ENCODING,
  }
}

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { AnalysisGeneration, FactTransaction } from '../generation/index.ts'
import type { AnalysisGenerationId, ProjectUniverseId, SourceManifestId } from '../identity/index.ts'
import type { AnalysisQuery, AnalysisSnapshotSet, AnalysisStore } from '../query/index.ts'
import type { AnalysisTelemetrySink } from '../profiling/index.ts'
import { dispatchAnalysisTelemetry } from '../profiling/dispatch.ts'
import {
  admitFactPayloadCodecs,
  type FactPayloadCodec,
  type FactPayloadCodecMap,
} from '../facts/representation/index.ts'

import { SQLiteLeaseRegistry } from './lifecycle/leases.ts'
import { collectSQLiteGenerations } from './lifecycle/retention.ts'
import {
  DEFAULT_SQLITE_ANALYSIS_LIMITS,
  DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION,
  type SQLitePayloadMaterialization,
} from './limits.ts'
import { prepareShardPayloads } from './materialization/payload.ts'
import { loadCurrentGeneration, loadGeneration } from './materialization/read.ts'
import {
  validateSQLiteTransaction,
  validateSQLiteTransactionBase,
} from './materialization/validate.ts'
import { writeTransaction } from './materialization/write.ts'
import { SQLitePinnedQuery } from './query/pinned.ts'
import { SQLiteSnapshotSet } from './query/snapshot-set.ts'
import { verifySQLiteAnalysisIntegrity } from './schema/integrity.ts'
import { migrateSQLiteAnalysisSchema } from './schema/migrate.ts'

export interface SQLiteAnalysisStoreOptions {
  readonly file: string
  readonly namespace: string
  readonly busyTimeoutMs?: number
  readonly leaseTimeoutMs?: number
  readonly maximumRetainedGenerations?: number
  readonly requireDurability?: boolean
  readonly telemetry?: AnalysisTelemetrySink
  /** Private physical payloads explicitly supported by this materializer. */
  readonly payloadCodecs?: readonly FactPayloadCodec[]
  readonly payloadMaterialization?: SQLitePayloadMaterialization
  readonly maximumDecompressedShardPayloadBytes?: number
  readonly maximumCachedShardPayloadBytes?: number
}

export async function createSQLiteAnalysisStore(
  options: SQLiteAnalysisStoreOptions,
): Promise<AnalysisStore> {
  validateOptions(options)
  const file = resolve(options.file)
  await mkdir(dirname(file), { recursive: true })
  const database = new DatabaseSync(file, {
    enableForeignKeyConstraints: true,
    readOnly: false,
    timeout: options.busyTimeoutMs ?? 5_000,
  })
  try {
    database.exec(
      `PRAGMA journal_mode = WAL;
       PRAGMA synchronous = ${options.requireDurability === false ? 'NORMAL' : 'FULL'};
       PRAGMA foreign_keys = ON;`,
    )
    migrateSQLiteAnalysisSchema(database)
    const payloadCodecs = admitFactPayloadCodecs(options.payloadCodecs)
    const quarantined = verifySQLiteAnalysisIntegrity(
      database,
      options.namespace,
      payloadCodecs,
      options.maximumDecompressedShardPayloadBytes ??
        DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumDecompressedShardPayloadBytes,
    )
    if (quarantined.length) {
      throw new Error(
        `Analysis SQLite quarantined ${quarantined.length} invalid derived generation(s): ${quarantined.join(', ')}`,
      )
    }
    return new SQLiteAnalysisStore(database, options, payloadCodecs)
  } catch (error) {
    database.close()
    throw error
  }
}

class SQLiteAnalysisStore implements AnalysisStore {
  readonly #leases: SQLiteLeaseRegistry
  readonly #maximumRetained: number
  readonly #database: DatabaseSync
  readonly #options: SQLiteAnalysisStoreOptions
  readonly #payloadCodecs: FactPayloadCodecMap
  readonly #maximumDecompressedShardPayloadBytes: number
  readonly #maximumCachedShardPayloadBytes: number
  #disposed = false

  constructor(
    database: DatabaseSync,
    options: SQLiteAnalysisStoreOptions,
    payloadCodecs: FactPayloadCodecMap,
  ) {
    this.#database = database
    this.#options = options
    this.#payloadCodecs = payloadCodecs
    this.#maximumDecompressedShardPayloadBytes =
      options.maximumDecompressedShardPayloadBytes ??
      DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumDecompressedShardPayloadBytes
    this.#maximumCachedShardPayloadBytes =
      options.maximumCachedShardPayloadBytes ??
      DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumCachedShardPayloadBytes
    const leaseTimeout = options.leaseTimeoutMs ?? 60_000
    this.#maximumRetained = options.maximumRetainedGenerations ?? 2
    this.#leases = new SQLiteLeaseRegistry(database, options.namespace, leaseTimeout)
  }

  async current(universe: ProjectUniverseId) {
    this.assertOpen()
    return loadCurrentGeneration(this.#database, this.#options.namespace, universe)
  }

  async commit(
    transaction: FactTransaction,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertOpen()
    options.signal?.throwIfAborted()
    const totalStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
    // Admit semantics against indexed membership before acquiring the
    // cross-process writer lock. Inside the transaction only the causal base
    // is rechecked; immutable admitted content cannot change while waiting.
    let phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
    const validated = validateSQLiteTransaction(this.#database, this.#options.namespace, transaction)
    this.emit('transaction.validate-before-lock', phaseStarted, transaction)
    options.signal?.throwIfAborted()
    phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
    const payloads = prepareShardPayloads(
      transaction.upserts,
      this.#maximumDecompressedShardPayloadBytes,
      this.#options.payloadMaterialization ?? DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION,
    )
    this.emit('transaction.encode-payloads', phaseStarted, transaction)
    options.signal?.throwIfAborted()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
      validateSQLiteTransactionBase(
        this.#database,
        this.#options.namespace,
        transaction,
        validated.currentSequence,
      )
      this.emit('transaction.validate-locked', phaseStarted, transaction)
      options.signal?.throwIfAborted()
      phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
      writeTransaction(this.#database, this.#options.namespace, transaction, payloads)
      this.emit('transaction.write', phaseStarted, transaction)
      phaseStarted = this.#options.telemetry ? process.hrtime.bigint() : 0n
      collectSQLiteGenerations(
        this.#database,
        this.#options.namespace,
        transaction.next.universe,
        this.#maximumRetained,
      )
      this.emit('transaction.retention', phaseStarted, transaction)
      this.#database.exec('COMMIT')
      this.emit('transaction.commit-total', totalStarted, transaction)
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK')
      throw error
    }
  }

  async open(
    universe: ProjectUniverseId,
    generation?: AnalysisGenerationId,
  ): Promise<AnalysisQuery> {
    this.assertOpen()
    this.#database.exec('BEGIN IMMEDIATE')
    let lease = ''
    let selected: AnalysisGeneration
    try {
      const candidate = loadGeneration(this.#database, this.#options.namespace, universe, generation)
      if (!candidate) {
        throw new Error(`Analysis generation is unavailable for universe ${universe}.`)
      }
      selected = candidate
      lease = this.#leases.insert(selected)
      this.#database.exec('COMMIT')
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK')
      throw error
    }
    this.#leases.start(lease)
    return new SQLitePinnedQuery(
      this.#database,
      this.#options.namespace,
      selected,
      this.#payloadCodecs,
      this.#maximumDecompressedShardPayloadBytes,
      this.#maximumCachedShardPayloadBytes,
      () => this.#leases.release(lease),
    )
  }

  async snapshotSet(
    generations: ReadonlyMap<ProjectUniverseId, AnalysisGenerationId>,
    inventory: SourceManifestId,
  ): Promise<AnalysisSnapshotSet> {
    this.assertOpen()
    const selected = new Map<ProjectUniverseId, AnalysisGeneration>()
    const leases: string[] = []
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      for (const [universe, generation] of generations) {
        const value = loadGeneration(this.#database, this.#options.namespace, universe, generation)
        if (!value) throw new Error(`Analysis generation ${generation} is unavailable.`)
        selected.set(universe, value)
        leases.push(this.#leases.insert(value))
      }
      this.#database.exec('COMMIT')
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK')
      for (const lease of leases) this.#leases.release(lease)
      throw error
    }
    for (const lease of leases) this.#leases.start(lease)
    return new SQLiteSnapshotSet(
      selected,
      inventory,
      (universe, generation) => this.open(universe, generation),
      () => {
        for (const lease of leases) this.#leases.release(lease)
      },
    )
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#leases.dispose()
    this.#database.close()
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('SQLite analysis store is disposed.')
  }

  private emit(phase: string, started: bigint, transaction: FactTransaction): void {
    const telemetry = this.#options.telemetry
    if (!telemetry) return
    dispatchAnalysisTelemetry(telemetry, {
      component: 'sqlite-store',
      phase,
      durationNs: Number(process.hrtime.bigint() - started),
      metrics: {
        manifestShards: transaction.manifest.length,
        upsertShards: transaction.upserts.length,
        deleteShards: transaction.deletes.length,
        upsertFacts: transaction.upserts.reduce((total, shard) => total + shard.facts.length, 0),
      },
    })
  }
}

function validateOptions(options: SQLiteAnalysisStoreOptions): void {
  if (!options.file) throw new TypeError('SQLite analysis store file is required.')
  if (!/^[A-Za-z0-9._:-]+$/u.test(options.namespace)) {
    throw new TypeError('SQLite analysis store namespace contains unsupported characters.')
  }
  const leaseTimeout = options.leaseTimeoutMs ?? 60_000
  if (!Number.isSafeInteger(leaseTimeout) || leaseTimeout < 1_000) {
    throw new RangeError('leaseTimeoutMs must be an integer of at least 1000.')
  }
  const maximumRetained = options.maximumRetainedGenerations ?? 2
  if (!Number.isSafeInteger(maximumRetained) || maximumRetained < 1) {
    throw new RangeError('maximumRetainedGenerations must be a positive integer.')
  }
  const maximumDecompressed =
    options.maximumDecompressedShardPayloadBytes ??
    DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumDecompressedShardPayloadBytes
  const maximumCached =
    options.maximumCachedShardPayloadBytes ??
    DEFAULT_SQLITE_ANALYSIS_LIMITS.maximumCachedShardPayloadBytes
  if (!Number.isSafeInteger(maximumDecompressed) || maximumDecompressed < 1_024) {
    throw new RangeError('maximumDecompressedShardPayloadBytes must be an integer of at least 1024.')
  }
  if (!Number.isSafeInteger(maximumCached) || maximumCached < maximumDecompressed) {
    throw new RangeError(
      'maximumCachedShardPayloadBytes must be an integer at least as large as one decompressed shard.',
    )
  }
  if (
    options.payloadMaterialization !== undefined &&
    options.payloadMaterialization !== 'inline-json' &&
    options.payloadMaterialization !== 'shard-brotli'
  ) {
    throw new TypeError('payloadMaterialization must be inline-json or shard-brotli.')
  }
}

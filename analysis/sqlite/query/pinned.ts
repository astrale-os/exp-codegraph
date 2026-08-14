import type { DatabaseSync } from 'node:sqlite'

import type { Completeness, Fact, FactShardReference } from '../../facts/index.ts'
import type { AnalysisGeneration } from '../../generation/index.ts'
import type { FactId } from '../../identity/index.ts'
import type {
  AnalysisQuery,
  CapabilityStatus,
  FactFilter,
  FactPage,
  PageRequest,
} from '../../query/index.ts'

import { combineCompleteness } from '../../internal/completeness.ts'
import {
  factFromRows,
  parseCapabilities,
  parseJson,
  type EvidenceRow,
  type FactRow,
  type InputRow,
} from '../materialization/model.ts'
import { loadManifest } from '../materialization/read.ts'
import { decodeSQLiteCursor, encodeSQLiteCursor } from './cursor.ts'
import { buildSQLiteFactFilter } from './filter.ts'

interface QueryFactRow extends FactRow {
  readonly evidence_json: string
  readonly inputs_json: string
}

export class SQLitePinnedQuery implements AnalysisQuery {
  #disposed = false
  readonly #database: DatabaseSync
  readonly #storeNamespace: string
  readonly generation: AnalysisGeneration
  readonly #release: () => void | Promise<void>

  constructor(
    database: DatabaseSync,
    storeNamespace: string,
    generation: AnalysisGeneration,
    release: () => void | Promise<void>,
  ) {
    this.#database = database
    this.#storeNamespace = storeNamespace
    this.generation = generation
    this.#release = release
  }

  async manifest(): Promise<readonly FactShardReference[]> {
    this.assertOpen()
    return loadManifest(
      this.#database,
      this.#storeNamespace,
      this.generation.universe,
      this.generation.sequence,
    )
  }

  async capabilities(): Promise<readonly CapabilityStatus[]> {
    this.assertOpen()
    const completion = new Map<string, Completeness>()
    for (const capability of this.generation.capabilities) {
      completion.set(capability, { kind: 'complete' })
    }
    const shards = this.#database
      .prepare(
        `SELECT shard.fact_namespace, shard.completion_json, shard.capabilities_json
         FROM analysis_generation_shards AS member
         JOIN analysis_shards AS shard
           ON shard.store_namespace = member.store_namespace
          AND shard.shard_digest = member.shard_digest
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?`,
      )
      .all(this.#storeNamespace, this.generation.universe, this.generation.sequence) as {
      readonly fact_namespace: string
      readonly completion_json: string
      readonly capabilities_json: string
    }[]
    const namespaceCapabilities = new Map<string, Set<string>>()
    for (const row of shards) {
      const value = parseJson(row.completion_json, 'shard completeness') as Completeness
      completion.set(
        row.fact_namespace,
        combineCompleteness(completion.get(row.fact_namespace), value),
      )
      const mapped = namespaceCapabilities.get(row.fact_namespace) ?? new Set<string>()
      for (const capability of parseCapabilities(row.capabilities_json, 'shard capabilities')) {
        mapped.add(capability)
        completion.set(
          capability,
          combineCompleteness(completion.get(capability), value),
        )
      }
      namespaceCapabilities.set(row.fact_namespace, mapped)
    }
    const facts = this.#database
      .prepare(
        `SELECT fact.fact_namespace, fact.completeness_json
         FROM analysis_generation_shards AS member
         JOIN analysis_facts AS fact
           ON fact.store_namespace = member.store_namespace
          AND fact.shard_digest = member.shard_digest
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?`,
      )
      .all(this.#storeNamespace, this.generation.universe, this.generation.sequence) as {
      readonly fact_namespace: string
      readonly completeness_json: string
    }[]
    for (const row of facts) {
      const value = parseJson(row.completeness_json, 'fact completeness') as Completeness
      completion.set(
        row.fact_namespace,
        combineCompleteness(completion.get(row.fact_namespace), value),
      )
      for (const capability of namespaceCapabilities.get(row.fact_namespace) ?? []) {
        completion.set(
          capability,
          combineCompleteness(completion.get(capability), value),
        )
      }
    }
    return [...completion]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([capability, completeness]) => ({ capability, completeness }))
  }

  async facts(filter: FactFilter = {}, page: PageRequest = { limit: 100 }): Promise<FactPage> {
    this.assertOpen()
    validatePageLimit(page.limit)
    const selected = buildSQLiteFactFilter(filter)
    const lastFact = page.cursor
      ? decodeSQLiteCursor(page.cursor, this.generation.id, filter)
      : undefined
    const baseParameters = [
      this.#storeNamespace,
      this.generation.universe,
      this.generation.sequence,
      ...selected.parameters,
    ]
    const total = (
      this.#database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM analysis_generation_shards AS member
           JOIN analysis_facts AS fact
             ON fact.store_namespace = member.store_namespace
            AND fact.shard_digest = member.shard_digest
           WHERE member.store_namespace = ?
             AND member.universe = ?
             AND member.generation_sequence = ?
             ${selected.sql}`,
        )
        .get(...baseParameters) as { readonly count: number }
    ).count
    const rows = this.#database
      .prepare(
        `${factSelectionSql()}
         WHERE member.store_namespace = ?
           AND member.universe = ?
           AND member.generation_sequence = ?
           ${selected.sql}
           ${lastFact ? 'AND fact.fact_id > ?' : ''}
         ORDER BY fact.fact_id
         LIMIT ?`,
      )
      .all(
        ...baseParameters,
        ...(lastFact ? [lastFact] : []),
        page.limit + 1,
      ) as unknown as QueryFactRow[]
    const hasNext = rows.length > page.limit
    if (hasNext) rows.pop()
    const facts = rows.map((row) => this.decodeFact(row))
    return {
      facts,
      ...(hasNext && facts.length
        ? {
            nextCursor: encodeSQLiteCursor(this.generation.id, filter, facts.at(-1)!.id),
          }
        : {}),
      total,
    }
  }

  async factsById(ids: readonly FactId[]): Promise<readonly Fact[]> {
    this.assertOpen()
    const unique = [...new Set(ids)].sort()
    if (!unique.length) return []
    const results: Fact[] = []
    for (let start = 0; start < unique.length; start += 500) {
      const chunk = unique.slice(start, start + 500)
      const rows = this.#database
        .prepare(
          `${factSelectionSql()}
           WHERE member.store_namespace = ?
             AND member.universe = ?
             AND member.generation_sequence = ?
             AND fact.fact_id IN (${chunk.map(() => '?').join(', ')})
           ORDER BY fact.fact_id`,
        )
        .all(
          this.#storeNamespace,
          this.generation.universe,
          this.generation.sequence,
          ...chunk,
        ) as unknown as QueryFactRow[]
      results.push(...rows.map((row) => this.decodeFact(row)))
    }
    return results.sort((left, right) => left.id.localeCompare(right.id))
  }

  async *export(filter: FactFilter = {}): AsyncIterable<Fact> {
    this.assertOpen()
    let cursor: string | undefined
    do {
      this.assertOpen()
      const page = await this.facts(filter, { limit: 1_000, ...(cursor ? { cursor } : {}) })
      for (const fact of page.facts) {
        this.assertOpen()
        yield fact
      }
      cursor = page.nextCursor
    } while (cursor)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#release()
  }

  private decodeFact(row: QueryFactRow): Fact {
    const evidence = parseJson(row.evidence_json, `fact ${row.fact_id} evidence`) as EvidenceRow[]
    const inputs = parseJson(row.inputs_json, `fact ${row.fact_id} inputs`) as InputRow[]
    if (!Array.isArray(evidence) || !Array.isArray(inputs)) {
      throw new TypeError(`Persisted fact ${row.fact_id} provenance is invalid.`)
    }
    return factFromRows(row, this.generation.id, evidence, inputs)
  }

  private assertOpen(): void {
    if (this.#disposed) throw new Error('Analysis query is disposed.')
  }
}

function factSelectionSql(): string {
  return `SELECT fact.*,
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
   AND fact.shard_digest = member.shard_digest`
}

function validatePageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError('Fact page limit must be an integer from 1 through 10000.')
  }
}

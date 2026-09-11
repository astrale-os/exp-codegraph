import type { FactShardReference } from '../../../facts/index.ts'
import type { FactTransaction } from '../../../generation/index.ts'
import type { AnalysisGenerationId, FactId, FactShardKey } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import { createTypeScriptFactReader } from '../../facts/index.ts'
import { IndexedValues, loadValueIndex, readIndexedBodies, type IndexedFact } from './facts.ts'
import { ValueIndexTable } from './table.ts'

type Kind = 'body' | 'symbol' | 'source'
interface Shard { readonly digest: string; readonly kind: Kind; readonly facts: readonly FactId[] }
interface Base { readonly index: Promise<IndexedValues>; readonly shards: ValueIndexTable<FactShardKey, Shard> }
interface Record {
  readonly generation: AnalysisGenerationId
  readonly shards?: ValueIndexTable<FactShardKey, Shard>
  base?: Base
  changed: ValueIndexTable<FactShardKey, Shard | undefined>
  pending?: Promise<IndexedValues>
  leases: number
}

/** Project-local ownership: one current revision plus explicit snapshot leases, with no history chain. */
export class ValueIndexOwner {
  readonly #records = new Map<AnalysisGenerationId, Record>()
  #current: Record | undefined
  #closed = false

  committed(transaction: FactTransaction): void {
    if (this.#closed) return
    const previous = this.#current
    const follows = previous?.generation === transaction.base
    const catalogue = (follows ? previous?.shards : undefined)?.edit() ?? new ValueIndexTable<FactShardKey, Shard>().edit()
    const replaced = new Set([...transaction.deletes, ...transaction.upserts.map((shard) => shard.key)])
    const relevant = transaction.upserts.filter((shard) => kind(shard.namespace))
    // Shard keys identify replaceable ownership slots, not a fixed namespace.
    // An upsert outside this index must still retire the slot's previous facts.
    if (follows) for (const key of replaced) catalogue.delete(key)
    for (const shard of relevant) catalogue.set(shard.key, {
      digest: shard.digest, kind: kind(shard.namespace)!, facts: Object.freeze(shard.facts.map((fact) => fact.id)),
    })
    const shards = catalogue.finish()
    // An external writer may have committed unseen shards. Fall back to a fresh query
    // until a complete transaction catalogue is available; never invent its membership.
    const complete = follows && previous?.shards !== undefined ||
      transaction.manifest.every((entry) => !kind(entry.namespace) || matches(shards.get(entry.key), entry))
    const base = complete && previous?.shards
      ? previous.pending ? { index: previous.pending, shards: previous.shards } : previous.base
      : undefined
    const changes = (base && !previous?.pending ? previous?.changed : undefined)?.edit() ?? new ValueIndexTable<FactShardKey, Shard | undefined>().edit()
    if (base) {
      const changedKeys = follows
        ? replaced
        : new Set([...base.shards.keys(), ...shards.keys()])
      for (const key of changedKeys) {
        const before = base.shards.get(key)
        const after = shards.get(key)
        if (before?.digest === after?.digest && before?.kind === after?.kind) changes.delete(key)
        else changes.set(key, after)
      }
    }
    const record: Record = {
      generation: transaction.next.id, ...(complete ? { shards } : {}), base,
      changed: changes.finish(), leases: 0,
    }
    this.#current = record
    this.#records.set(record.generation, record)
    if (previous && previous.leases === 0 && previous.generation !== record.generation) this.#records.delete(previous.generation)
  }

  acquire(query: AnalysisQuery): { load(): Promise<IndexedValues>; release(): void } {
    let record = this.#records.get(query.generation.id)
    if (!record) {
      record = { generation: query.generation.id, changed: new ValueIndexTable(), leases: 0 }
      if (!this.#closed) this.#records.set(record.generation, record)
    }
    record.leases++
    let released = false
    return {
      load: () => {
        const active = record
        if (!active) return Promise.reject(new Error('Value index snapshot lease is released.'))
        active.pending ??= this.load(active, query).catch((error) => { active.pending = undefined; throw error })
        return active.pending
      },
      release: () => {
        if (released) return
        released = true
        const previous = record!
        record = undefined
        previous.leases--
        if (previous.leases === 0 && previous !== this.#current && this.#records.get(previous.generation) === previous) this.#records.delete(previous.generation)
      },
    }
  }

  close(): void { this.#closed = true; this.#current = undefined; this.#records.clear() }

  private async load(record: Record, query: AnalysisQuery): Promise<IndexedValues> {
    const base = record.base
    if (!base) return loadValueIndex(query)
    // A snapshot may be disposed or fail admission while a later revision is
    // waiting for its lazy base. Its rejected promise is not a permanent lineage.
    const index = await base.index.catch(() => undefined)
    if (!index) {
      record.base = undefined
      record.changed = new ValueIndexTable()
      return loadValueIndex(query)
    }
    const reader = createTypeScriptFactReader(query)
    const ids: { [Key in Kind]: FactId[] } = { body: [], symbol: [], source: [] }
    const deleted: FactId[] = []
    for (const [key, shard] of record.changed) {
      deleted.push(...base.shards.get(key)?.facts ?? [])
      if (shard) ids[shard.kind].push(...shard.facts)
    }
    const [bodies, symbols, sources, capabilities] = await Promise.all([
      readIndexedBodies(query, ids.body), reader.factsById('symbol', ids.symbol), reader.factsById('source', ids.source),
      query.capabilities(),
    ])
    if (bodies.length !== ids.body.length || symbols.length !== ids.symbol.length || sources.length !== ids.source.length) {
      throw new Error('A committed value index shard is missing facts in its pinned query.')
    }
    const next = index.update([...bodies, ...symbols, ...sources] as IndexedFact[], deleted, false, capabilities)
    // Resolved indices and trie roots stand alone. A quiet watch cannot retain a
    // linked list of previous revisions, transactions, queries or deleted shards.
    record.base = undefined
    record.changed = new ValueIndexTable()
    return next
  }
}

function kind(namespace: string): Kind | undefined {
  return namespace === 'typescript.body' ? 'body' : namespace === 'typescript.symbol' ? 'symbol'
    : namespace === 'typescript.source' ? 'source' : undefined
}
function matches(shard: Shard | undefined, reference: FactShardReference): boolean {
  return !!shard && shard.digest === reference.digest && shard.kind === kind(reference.namespace) && shard.facts.length === reference.facts
}

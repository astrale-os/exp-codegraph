import { createHash } from 'node:crypto'
import type { FactId, OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import type { BodyOccurrence, ResolvedCall } from '../../body/index.ts'
import { createTypeScriptFactReader, type TypeScriptFact } from '../../facts/index.ts'
import type { ValueResult } from '../model.ts'
import { ValueIndexTable, type ValueIndexTableEdit } from './table.ts'

type Body = TypeScriptFact<'body'>
export type IndexedFact = Body | TypeScriptFact<'symbol'> | TypeScriptFact<'source'>
export interface ValueDependency { readonly key: string; readonly fingerprint: string | undefined }
export interface ValueIndexRevision {
  readonly token: object
  readonly parent?: object
  readonly changed: ReadonlySet<string>
}
export interface ValueIndex {
  readonly bodies: ReadonlyMap<SymbolId, Body>
  readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>
  readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>
  readonly parents: ReadonlyMap<OccurrenceId, readonly { parent: OccurrenceId; role: string }[]>
  readonly definitions: ReadonlyMap<OccurrenceId, readonly OccurrenceId[]>
  readonly definiteDefinitions: ReadonlySet<OccurrenceId>
  readonly initializers: ReadonlyMap<SymbolId, readonly OccurrenceId[]>
  readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>
  readonly direct: ReadonlyMap<OccurrenceId, ValueResult<unknown>>
  readonly symbols: ReadonlyMap<SymbolId, TypeScriptFact<'symbol'>>
  readonly sources: ReadonlyMap<SourceId, TypeScriptFact<'source'>>
  readonly mutations: ReadonlyMap<SymbolId, readonly SymbolId[]>
  readonly escapes: ReadonlySet<SymbolId>
  readonly aliases: ReadonlyMap<SymbolId, readonly SymbolId[]>
  readonly fingerprints: Pick<ReadonlyMap<string, string>, 'get'>
  readonly evidence: Pick<ReadonlyMap<string, readonly FactId[]>, 'get'>
  readonly revision: ValueIndexRevision
  dependency(key: string): ValueDependency
}

type Slot<Value> = { readonly owner: FactId; readonly value: Value } |
  { readonly owners: ReadonlyMap<FactId, Value>; readonly value: Value }

/** Most lookups have one contributing fact; uncommon overlaps retain their precise ordered owners. */
class Column<Key extends string, Value> implements ReadonlyMap<Key, Value> {
  readonly [Symbol.toStringTag] = 'ValueIndexColumn'
  readonly slots: ValueIndexTable<Key, Slot<Value>>
  readonly merge: (values: readonly Value[]) => Value
  constructor(slots = new ValueIndexTable<Key, Slot<Value>>(), merge: (values: readonly Value[]) => Value = last) {
    this.slots = slots
    this.merge = merge
  }
  get size(): number { return this.slots.size }
  get(key: Key): Value | undefined { return this.slots.get(key)?.value }
  has(key: Key): boolean { return this.slots.has(key) }
  fingerprint(key: Key, hashes: ValueIndexTable<FactId, string>): string | undefined {
    const slot = this.slots.get(key)
    if (!slot) return
    return 'owner' in slot ? hashes.get(slot.owner)
      : JSON.stringify([...slot.owners.keys()].sort().map((owner) => [owner, hashes.get(owner)]))
  }
  evidence(key: Key, facts: ValueIndexTable<FactId, readonly FactId[]>): readonly FactId[] | undefined {
    const slot = this.slots.get(key)
    if (!slot) return
    return 'owner' in slot ? facts.get(slot.owner) : [...slot.owners.keys()].sort()
  }
  edit(): ColumnEdit<Key, Value> { return new ColumnEdit(this.slots.edit(), this.merge) }
  *entries(): MapIterator<[Key, Value]> { for (const [key, slot] of this.slots) yield [key, slot.value] }
  *keys(): MapIterator<Key> { yield* this.slots.keys() }
  *values(): MapIterator<Value> { for (const slot of this.slots.values()) yield slot.value }
  [Symbol.iterator](): MapIterator<[Key, Value]> { return this.entries() }
  forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callback.call(thisArg, value, key, this)
  }
}

class ColumnEdit<Key extends string, Value> {
  readonly slots: ValueIndexTableEdit<Key, Slot<Value>>
  readonly merge: (values: readonly Value[]) => Value
  constructor(slots: ValueIndexTableEdit<Key, Slot<Value>>, merge: (values: readonly Value[]) => Value) {
    this.slots = slots
    this.merge = merge
  }
  get(key: Key): Value | undefined { return this.slots.get(key)?.value }
  set(key: Key, owner: FactId, value: Value): void {
    const old = this.slots.get(key)
    if (!old || 'owner' in old && old.owner === owner) { this.slots.set(key, { owner, value }); return }
    const owners = 'owner' in old ? new Map([[old.owner, old.value]]) : new Map(old.owners)
    owners.set(owner, value)
    this.slots.set(key, { owners, value: this.merge([...owners].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item)) })
  }
  delete(key: Key, owner: FactId): void {
    const old = this.slots.get(key)
    if (!old) return
    if ('owner' in old) { if (old.owner === owner) this.slots.delete(key); return }
    if (!old.owners.has(owner)) return
    const owners = new Map(old.owners)
    owners.delete(owner)
    if (owners.size === 1) {
      const [remaining, value] = owners.entries().next().value!
      this.slots.set(key, { owner: remaining, value })
    } else this.slots.set(key, { owners, value: this.merge([...owners].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item)) })
  }
  finish(): Column<Key, Value> { return new Column(this.slots.finish(), this.merge) }
}

interface Alias { readonly from: SymbolId; readonly occurrence: OccurrenceId }
interface Derived {
  readonly initializers: ReadonlyMap<SymbolId, readonly OccurrenceId[]>
  readonly mutations: ReadonlyMap<SymbolId, readonly OccurrenceId[]>
  readonly escapes: ReadonlyMap<SymbolId, readonly OccurrenceId[]>
  readonly aliases: ReadonlyMap<SymbolId, readonly Alias[]>
  readonly inputs: ReadonlySet<string>
}
interface Columns {
  readonly bodies: Column<SymbolId, Body>
  readonly occurrences: Column<OccurrenceId, BodyOccurrence>
  readonly children: Column<OccurrenceId, ReadonlyMap<string, OccurrenceId>>
  readonly parents: Column<OccurrenceId, readonly { parent: OccurrenceId; role: string }[]>
  readonly definitions: Column<OccurrenceId, readonly OccurrenceId[]>
  readonly definite: Column<OccurrenceId, true>
  readonly calls: Column<OccurrenceId, ResolvedCall>
  readonly direct: Column<OccurrenceId, ValueResult<unknown>>
  readonly symbols: Column<SymbolId, TypeScriptFact<'symbol'>>
  readonly sources: Column<SourceId, TypeScriptFact<'source'>>
  readonly initializers: Column<SymbolId, readonly OccurrenceId[]>
  readonly mutations: Column<SymbolId, readonly OccurrenceId[]>
  readonly escapes: Column<SymbolId, readonly OccurrenceId[]>
  readonly aliases: Column<SymbolId, readonly Alias[]>
  readonly dependents: Column<string, readonly FactId[]>
}
type Edits = { [Key in keyof Columns]: ReturnType<Columns[Key]['edit']> }

export class IndexedValues implements ValueIndex {
  readonly work: { readonly facts: number; readonly bodies: number }
  readonly bodies: ValueIndex['bodies']
  readonly occurrences: ValueIndex['occurrences']
  readonly children: ValueIndex['children']
  readonly parents: ValueIndex['parents']
  readonly definitions: ValueIndex['definitions']
  readonly definiteDefinitions: ValueIndex['definiteDefinitions']
  readonly initializers: ValueIndex['initializers']
  readonly calls: ValueIndex['calls']
  readonly direct: ValueIndex['direct']
  readonly symbols: ValueIndex['symbols']
  readonly sources: ValueIndex['sources']
  readonly mutations: ValueIndex['mutations']
  readonly escapes: ValueIndex['escapes']
  readonly aliases: ValueIndex['aliases']
  readonly fingerprints: ValueIndex['fingerprints']
  readonly evidence: ValueIndex['evidence']
  readonly revision: ValueIndexRevision
  readonly #facts: ValueIndexTable<FactId, IndexedFact>
  readonly #columns: Columns
  readonly #derived: ValueIndexTable<FactId, Derived>
  readonly #hashes: ValueIndexTable<FactId, string>
  readonly #factEvidence: ValueIndexTable<FactId, readonly FactId[]>
  readonly #witnesses: ValueIndexTable<string, ValueDependency>
  readonly #aggregateEvidence: ValueIndexTable<string, readonly FactId[]>
  readonly #mutationOwners: ValueIndexTable<SymbolId, readonly SymbolId[]>
  readonly #aliasSources: ValueIndexTable<SymbolId, readonly SymbolId[]>

  private constructor(
    facts: ValueIndexTable<FactId, IndexedFact>, columns: Columns, derived: ValueIndexTable<FactId, Derived>,
    hashes: ValueIndexTable<FactId, string>, factEvidence: ValueIndexTable<FactId, readonly FactId[]>,
    witnesses: ValueIndexTable<string, ValueDependency>, aggregateEvidence: ValueIndexTable<string, readonly FactId[]>,
    mutationOwners: ValueIndexTable<SymbolId, readonly SymbolId[]>, aliasSources: ValueIndexTable<SymbolId, readonly SymbolId[]>,
    revision: ValueIndexRevision,
    work = { facts: 0, bodies: 0 },
  ) {
    this.#facts = facts; this.#columns = columns; this.#derived = derived
    this.#hashes = hashes; this.#factEvidence = factEvidence
    this.#witnesses = witnesses; this.#aggregateEvidence = aggregateEvidence
    this.#mutationOwners = mutationOwners; this.#aliasSources = aliasSources
    this.revision = revision
    this.work = Object.freeze(work)
    this.bodies = columns.bodies; this.occurrences = columns.occurrences; this.children = columns.children
    this.parents = columns.parents; this.definitions = columns.definitions; this.definiteDefinitions = keysSet(columns.definite)
    this.initializers = columns.initializers; this.calls = columns.calls; this.direct = columns.direct
    this.symbols = columns.symbols; this.sources = columns.sources
    this.mutations = mutationOwners; this.escapes = keysSet(columns.escapes); this.aliases = aliasSources
    this.fingerprints = { get: (key) => this.fingerprint(key) }
    this.evidence = { get: (key) => {
      if (key.startsWith('function:')) return columns.bodies.evidence(key.slice(9) as SymbolId, factEvidence)
      if (key.startsWith('occurrence:')) return columns.occurrences.evidence(key.slice(11) as OccurrenceId, factEvidence)
      if (key.startsWith('symbol:')) return columns.symbols.evidence(key.slice(7) as SymbolId, factEvidence)
      return this.#aggregateEvidence.get(key)
    } }
  }

  static empty(): IndexedValues {
    const columns: Columns = {
      bodies: new Column(), occurrences: new Column(), children: new Column(undefined, (values) => new Map(values.flatMap((value) => [...value]))),
      parents: new Column(undefined, flatten), definitions: new Column(undefined, flatten), definite: new Column(),
      calls: new Column(), direct: new Column(), symbols: new Column(), sources: new Column(),
      initializers: new Column(undefined, flatten), mutations: new Column(undefined, flatten), escapes: new Column(undefined, flatten),
      aliases: new Column(undefined, flatten), dependents: new Column(undefined, flatten),
    }
    return new IndexedValues(new ValueIndexTable(), columns, new ValueIndexTable(), new ValueIndexTable(),
      new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(), new ValueIndexTable(),
      { token: {}, changed: new Set() })
  }

  dependency(key: string): ValueDependency {
    let canonical = key
    if (key.startsWith('occurrence:')) {
      const occurrence = this.occurrences.get(key.slice(11) as OccurrenceId)
      const candidate = occurrence && `function:${occurrence.owner}`
      if (candidate && this.fingerprint(candidate) === this.fingerprint(key)) canonical = candidate
    }
    return this.#witnesses.get(canonical) ?? Object.freeze({ key: canonical, fingerprint: this.fingerprint(canonical) })
  }

  private fingerprint(key: string): string | undefined {
    if (key.startsWith('function:')) return this.#columns.bodies.fingerprint(key.slice(9) as SymbolId, this.#hashes)
    if (key.startsWith('occurrence:')) return this.#columns.occurrences.fingerprint(key.slice(11) as OccurrenceId, this.#hashes)
    if (key.startsWith('symbol:')) return this.#columns.symbols.fingerprint(key.slice(7) as SymbolId, this.#hashes)
    return this.#witnesses.get(key)?.fingerprint
  }

  update(upserts: readonly IndexedFact[], deletes: readonly FactId[], initial = false): IndexedValues {
    const facts = this.#facts.edit()
    const hashes = this.#hashes.edit()
    const factEvidence = this.#factEvidence.edit()
    const derived = this.#derived.edit()
    const columns = Object.fromEntries(Object.entries(this.#columns).map(([key, column]) => [key, column.edit()])) as Edits
    const touched = new Set<string>()
    const inputs = new Set<string>()
    const changed = new Map<FactId, IndexedFact | undefined>()
    for (const id of deletes) if (this.#facts.has(id)) changed.set(id, undefined)
    for (const fact of upserts) {
      const previous = this.#facts.get(fact.id)
      if (previous?.payload === fact.payload && previous.completeness === fact.completeness && previous.provenance === fact.provenance) {
        changed.delete(fact.id)
        continue
      }
      changed.set(fact.id, fact)
    }
    for (const [id, next] of changed) {
      const previous = this.#facts.get(id)
      if (previous) primary(columns, previous, false, touched, inputs)
      if (next) {
        primary(columns, next, true, touched, inputs)
        facts.set(id, next)
        hashes.set(id, hashFact(next))
        factEvidence.set(id, Object.freeze([id]))
      } else { facts.delete(id); hashes.delete(id); factEvidence.delete(id) }
    }
    const affected = new Set<FactId>()
    for (const [id, fact] of changed) if (fact?.namespace === 'typescript.body' || this.#derived.has(id)) affected.add(id)
    for (const key of inputs) {
      // Effect classification asks whether a callee body exists, not for its contents.
      if (key.startsWith('function:') && this.bodies.has(key.slice(9) as SymbolId) === !!columns.bodies.get(key.slice(9) as SymbolId)) continue
      for (const id of this.#columns.dependents.get(key) ?? []) affected.add(id)
    }
    for (const id of affected) {
      const previous = this.#derived.get(id)
      if (previous) derivedColumns(columns, id, previous, false, touched)
      const fact = facts.get(id)
      if (fact?.namespace === 'typescript.body') {
        const next = derive(fact, columns)
        derivedColumns(columns, id, next, true, touched)
        derived.set(id, next)
      } else derived.delete(id)
    }
    const nextColumns = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, column.finish()])) as unknown as Columns
    const nextHashes = hashes.finish()
    const nextEvidence = factEvidence.finish()
    const witnesses = this.#witnesses.edit()
    const aggregateEvidence = this.#aggregateEvidence.edit()
    const mutationOwners = this.#mutationOwners.edit()
    const aliasSources = this.#aliasSources.edit()
    const directFingerprint = (key: string): string | undefined => key.startsWith('function:')
      ? nextColumns.bodies.fingerprint(key.slice(9) as SymbolId, nextHashes) : key.startsWith('occurrence:')
      ? nextColumns.occurrences.fingerprint(key.slice(11) as OccurrenceId, nextHashes) : key.startsWith('symbol:')
      ? nextColumns.symbols.fingerprint(key.slice(7) as SymbolId, nextHashes) : undefined
    const occurrenceFingerprint = (id: OccurrenceId) => nextColumns.occurrences.fingerprint(id, nextHashes)
    const occurrenceEvidence = (ids: readonly OccurrenceId[]) => [...new Set(ids.flatMap((id) =>
      nextColumns.occurrences.evidence(id, nextEvidence) ?? []))]
    const changedKeys = new Set<string>()
    for (const key of touched) {
      let fingerprint = directFingerprint(key)
      const separator = key.indexOf(':')
      const kind = key.slice(0, separator)
      const symbol = key.slice(separator + 1) as SymbolId
      if (kind === 'initializers') {
        const values = nextColumns.initializers.get(symbol)
        if (values) {
          fingerprint = JSON.stringify([...values].sort().map((id) => [id, occurrenceFingerprint(id)]))
          aggregateEvidence.set(key, occurrenceEvidence(values))
        }
        else aggregateEvidence.delete(key)
      } else if (kind === 'mutation' || kind === 'escape' || kind === 'aliases') {
        const aliases = kind === 'aliases' ? nextColumns.aliases.get(symbol) : undefined
        const values = aliases?.map((alias) => alias.occurrence) ??
          (kind === 'mutation' ? nextColumns.mutations.get(symbol) : kind === 'escape' ? nextColumns.escapes.get(symbol) : undefined)
        if (values?.length) {
          const ids = [...new Set(values)].sort()
          fingerprint = JSON.stringify(ids.map((id) => [`occurrence:${id}`, occurrenceFingerprint(id)]))
          aggregateEvidence.set(key, occurrenceEvidence(ids))
          if (kind === 'mutation') mutationOwners.set(symbol, [...new Set(ids.map((id) => nextColumns.occurrences.get(id)!.owner))])
          if (kind === 'aliases') aliasSources.set(symbol, [...new Set(aliases!.map((alias) => alias.from))])
        } else {
          aggregateEvidence.delete(key)
          if (kind === 'mutation') mutationOwners.delete(symbol)
          if (kind === 'aliases') aliasSources.delete(symbol)
        }
      }
      if (!initial && this.fingerprint(key) !== fingerprint) changedKeys.add(key)
      // Present occurrences normally share the selected function witness. Store
      // one whole-body witness instead of another object/trie entry per AST node.
      // Rare overlapping owners use an exact on-demand occurrence witness.
      if (kind === 'occurrence') continue
      if (fingerprint === undefined) witnesses.delete(key)
      else if (this.#witnesses.get(key)?.fingerprint !== fingerprint) witnesses.set(key, Object.freeze({ key, fingerprint }))
    }
    return new IndexedValues(facts.finish(), nextColumns, derived.finish(), nextHashes, nextEvidence, witnesses.finish(),
      aggregateEvidence.finish(), mutationOwners.finish(), aliasSources.finish(),
      { token: {}, ...(!initial ? { parent: this.revision.token } : {}), changed: changedKeys },
      { facts: changed.size, bodies: affected.size })
  }
}

export async function loadValueIndex(query: AnalysisQuery): Promise<IndexedValues> {
  const reader = createTypeScriptFactReader(query)
  const facts = await Promise.all([collect(reader.export('body')), collect(reader.export('symbol')), collect(reader.export('source'))])
  return IndexedValues.empty().update(facts.flat(), [], true)
}

function primary(columns: Edits, fact: IndexedFact, add: boolean, touched: Set<string>, inputs: Set<string>): void {
  const owner = fact.id
  const apply = <Key extends string, Value>(column: ColumnEdit<Key, Value>, key: Key, value: Value) => {
    if (add) column.set(key, owner, value)
    else column.delete(key, owner)
  }
  if (fact.namespace === 'typescript.symbol') {
    apply(columns.symbols, fact.payload.symbol, fact)
    touched.add(`symbol:${fact.payload.symbol}`)
    return
  }
  if (fact.namespace === 'typescript.source') { apply(columns.sources, fact.payload.source, fact); return }
  const body = fact.payload.body
  apply(columns.bodies, body.function, fact)
  touched.add(`function:${body.function}`); inputs.add(`function:${body.function}`)
  for (const occurrence of body.occurrences) {
    const previous = columns.occurrences.get(occurrence.id)
    if (add && previous && previous.owner !== occurrence.owner) throw new Error(`Occurrence ${occurrence.id} has multiple function owners.`)
    apply(columns.occurrences, occurrence.id, occurrence)
    touched.add(`occurrence:${occurrence.id}`); inputs.add(`occurrence:${occurrence.id}`)
  }
  const children = new Map<OccurrenceId, Map<string, OccurrenceId>>()
  const parents = new Map<OccurrenceId, { parent: OccurrenceId; role: string }[]>()
  for (const relation of body.relations) {
    let values = children.get(relation.parent)
    if (!values) children.set(relation.parent, (values = new Map()))
    values.set(relation.role, relation.child)
    append(parents, relation.child, { parent: relation.parent, role: relation.role })
  }
  for (const [key, value] of children) { apply(columns.children, key, value); inputs.add(`children:${key}`) }
  for (const [key, value] of parents) apply(columns.parents, key, value)
  const definitions = new Map<OccurrenceId, OccurrenceId[]>()
  const definite = new Set<OccurrenceId>()
  for (const definition of body.definitions) {
    append(definitions, definition.use, definition.definition)
    if (definition.reaching === 'definite') definite.add(definition.use)
  }
  for (const [key, value] of definitions) apply(columns.definitions, key, value)
  for (const key of definite) apply(columns.definite, key, true)
  for (const call of body.calls) apply(columns.calls, call.occurrence, call)
  for (const [key, value] of Object.entries(fact.payload.values)) apply(columns.direct, key as OccurrenceId, value)
}

function derive(fact: Body, columns: Edits): Derived {
  const inputs = new Set<string>()
  const occurrence = (id: OccurrenceId) => { inputs.add(`occurrence:${id}`); return columns.occurrences.get(id) }
  const children = (id: OccurrenceId) => { inputs.add(`children:${id}`); return columns.children.get(id) }
  const rootSymbol = (id: OccurrenceId | undefined): SymbolId | undefined => {
    const seen = new Set<OccurrenceId>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const node = occurrence(id)
      if (!node) return
      if (node.syntax === 'Identifier') return node.symbol
      const links = children(id)
      if (node.syntax === 'PropertyAccessExpression' || node.syntax === 'ElementAccessExpression') id = links?.get('receiver') ?? links?.get('child:0')
      else if (TRANSPARENT_SYNTAX.has(node.syntax)) id = links?.get('expression')
      else return
    }
    return
  }
  const initializers = new Map<SymbolId, OccurrenceId[]>()
  const mutations = new Map<SymbolId, OccurrenceId[]>()
  const escapes = new Map<SymbolId, OccurrenceId[]>()
  const aliases = new Map<SymbolId, Alias[]>()
  for (const node of fact.payload.body.occurrences) {
    if (node.syntax === 'VariableDeclaration') {
      const links = children(node.id)
      const name = links?.get('name')
      const initializer = links?.get('initializer')
      const symbol = name && occurrence(name)?.symbol
      if (symbol && initializer) {
        append(initializers, symbol, initializer)
        const target = rootSymbol(initializer)
        if (target && target !== symbol) append(aliases, target, { from: symbol, occurrence: initializer })
      }
    }
    const target = node.kind === 'assignment' ? children(node.id)?.get('left')
      : node.syntax === 'DeleteExpression' ? children(node.id)?.get('expression') : undefined
    const symbol = rootSymbol(target)
    if (symbol) append(mutations, symbol, node.id)
  }
  for (const call of fact.payload.body.calls) {
    for (const binding of call.bindings) {
      const argument = rootSymbol(binding.argument)
      if (binding.parameter && argument && binding.parameter !== argument) append(aliases, argument, { from: binding.parameter, occurrence: call.occurrence })
    }
    if (call.target) inputs.add(`function:${call.target}`)
    if (call.target && columns.bodies.get(call.target) && !call.dynamic) continue
    for (const argument of call.arguments) {
      const symbol = rootSymbol(argument)
      if (symbol) append(escapes, symbol, call.occurrence)
    }
  }
  return { initializers, mutations, escapes, aliases, inputs }
}

function derivedColumns(columns: Edits, owner: FactId, value: Derived, add: boolean, touched: Set<string>): void {
  for (const [column, prefix, entries] of [
    [columns.initializers, 'initializers', value.initializers], [columns.mutations, 'mutation', value.mutations],
    [columns.escapes, 'escape', value.escapes],
  ] as const) {
    for (const [key, items] of entries) {
      if (add) column.set(key, owner, items)
      else column.delete(key, owner)
      touched.add(`${prefix}:${key}`)
    }
  }
  for (const [key, items] of value.aliases) {
    if (add) columns.aliases.set(key, owner, items)
    else columns.aliases.delete(key, owner)
    touched.add(`aliases:${key}`)
  }
  for (const key of value.inputs) {
    if (add) columns.dependents.set(key, owner, [owner])
    else columns.dependents.delete(key, owner)
  }
}

function hashFact(fact: IndexedFact): string {
  return createHash('sha256').update(JSON.stringify({ id: fact.id, payload: fact.payload, completeness: fact.completeness })).digest('hex')
}
function last<Value>(values: readonly Value[]): Value { return values.at(-1)! }
function flatten<Value>(values: readonly (readonly Value[])[]): readonly Value[] { return values.flat() }
function append<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  let values = map.get(key)
  if (!values) map.set(key, (values = []))
  values.push(value)
}
async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const result: Value[] = []
  for await (const value of values) result.push(value)
  return result
}
function keysSet<Key extends string>(map: ReadonlyMap<Key, unknown>): ReadonlySet<Key> {
  return {
    size: map.size, has: (key) => map.has(key), keys: () => map.keys(), values: () => map.keys(),
    *entries(): SetIterator<[Key, Key]> { for (const key of map.keys()) yield [key, key] },
    [Symbol.iterator]: () => map.keys(),
    forEach(callback, thisArg) { for (const key of map.keys()) callback.call(thisArg, key, key, this) },
  }
}
const TRANSPARENT_SYNTAX = new Set(['ParenthesizedExpression', 'NonNullExpression', 'SatisfiesExpression', 'AsExpression', 'TypeAssertionExpression'])

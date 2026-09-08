import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/index.ts'
import type { BodyOccurrence, ResolvedCall } from '../../body/index.ts'
import type { TypeScriptFact } from '../../facts/index.ts'
import { projectPackedTypeScriptBody, type PackedTypeScriptBodyProjection } from '../../physical/index.ts'
import type { ValueResult } from '../model.ts'

export interface NodeReference { readonly fragment: BodyFragment; readonly row: number }
interface LogicalBodyStorage {
  readonly occurrences: readonly BodyOccurrence[]
  readonly calls: readonly ResolvedCall[]
  readonly nodes: readonly NodeReference[]
  readonly callReferences: readonly NodeReference[]
  readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>
  readonly parents: ReadonlyMap<OccurrenceId, readonly { parent: OccurrenceId; role: string }[]>
  readonly definitions: ReadonlyMap<OccurrenceId, readonly OccurrenceId[]>
  readonly definite: ReadonlySet<OccurrenceId>
}
export class BodyFragment {
  readonly fact: TypeScriptFact<'body'>
  readonly owner: SymbolId
  readonly source: SourceId | undefined
  readonly effects: readonly number[]
  readonly callsBySource: ReadonlyMap<SourceId, readonly OccurrenceId[]>
  readonly packed: PackedTypeScriptBodyProjection | undefined
  readonly #logical: LogicalBodyStorage | undefined

  constructor(fact: TypeScriptFact<'body'>) {
    this.packed = projectPackedTypeScriptBody(fact)
    this.fact = this.packed ? fact : snapshotFact(fact)
    if (this.packed) {
      this.owner = this.packed.owner
      this.source = this.packed.source
      this.effects = this.packed.effectCandidates
      this.callsBySource = new Map(this.packed.calls.length ? [[this.source, this.packed.calls.map((_, row) => this.callId(row))]] : [])
    } else {
      const body = this.fact.payload.body
      this.owner = body.function
      this.source = body.occurrences[0]?.span.source ?? fact.provenance.evidence[0]?.source
      const occurrences = body.occurrences
      const calls = body.calls
      const callSources = new Map<SourceId, OccurrenceId[]>()
      const sources = new Map(body.occurrences.map((node) => [node.id, node.span.source]))
      for (const call of body.calls) {
        const source = sources.get(call.occurrence)
        if (source) append(callSources, source, call.occurrence)
      }
      this.callsBySource = callSources
      const nodes = body.occurrences.map((_, row) => ({ fragment: this, row }))
      const callReferences = body.calls.map((_, row) => ({ fragment: this, row }))
      this.effects = body.occurrences.flatMap((node, row) => node.syntax === 'VariableDeclaration' ||
        node.syntax === 'DeleteExpression' || node.kind === 'assignment' ? [row] : [])
      const children = new Map<OccurrenceId, Map<string, OccurrenceId>>()
      const parents = new Map<OccurrenceId, { parent: OccurrenceId; role: string }[]>()
      const definitions = new Map<OccurrenceId, OccurrenceId[]>()
      const definite = new Set<OccurrenceId>()
      for (const relation of body.relations) {
        let outgoing = children.get(relation.parent)
        if (!outgoing) children.set(relation.parent, (outgoing = new Map()))
        outgoing.set(relation.role, relation.child)
        append(parents, relation.child, { parent: relation.parent, role: relation.role })
      }
      for (const definition of body.definitions) {
        append(definitions, definition.use, definition.definition)
        if (definition.reaching === 'definite') definite.add(definition.use)
      }
      this.#logical = { occurrences, calls, nodes, callReferences, children, parents, definitions, definite }
    }
  }

  logicalNodes(): readonly NodeReference[] { return this.#logical!.nodes }
  logicalCalls(): readonly NodeReference[] { return this.#logical!.callReferences }
  id(row: number): OccurrenceId { return this.packed?.occurrences[row] ?? this.#logical!.occurrences[row]!.id }
  effectNode(row: number): Pick<BodyOccurrence, 'id' | 'kind' | 'syntax' | 'symbol' | 'owner'> { return this.packed?.effectNode(row) ?? this.#logical!.occurrences[row]! }
  effectCall(row: number): Pick<ResolvedCall, 'occurrence' | 'target' | 'dynamic' | 'arguments' | 'bindings'> { return this.packed?.effectCall(row) ?? this.#logical!.calls[row]! }
  node(row: number): BodyOccurrence { return this.packed?.occurrence(row) ?? this.#logical!.occurrences[row]! }
  callId(row: number): OccurrenceId { return this.packed ? this.packed.occurrences[this.packed.calls[row]!]! : this.#logical!.calls[row]!.occurrence }
  call(row: number): ResolvedCall { return this.packed?.call(row) ?? this.#logical!.calls[row]! }
  children(row: number): ReadonlyMap<string, OccurrenceId> | undefined { return this.packed ? this.packed.children(row) : this.#logical!.children.get(this.id(row)) }
  parents(row: number): readonly { parent: OccurrenceId; role: string }[] | undefined { return this.packed ? this.packed.parents(row) : this.#logical!.parents.get(this.id(row)) }
  definitions(row: number): readonly OccurrenceId[] | undefined { return this.packed ? this.packed.definitions(row) : this.#logical!.definitions.get(this.id(row)) }
  definite(row: number): boolean { return this.packed ? this.packed.definite(row) : this.#logical!.definite.has(this.id(row)) }
  value(row: number): ValueResult<unknown> | undefined { return this.packed ? this.packed.value(row) : this.fact.payload.values[this.id(row)] }
}

const FRAGMENTS = new WeakMap<TypeScriptFact<'body'>, BodyFragment>()
export function bodyFragment(fact: TypeScriptFact<'body'>): BodyFragment {
  let fragment = FRAGMENTS.get(fact)
  if (!fragment) { fragment = new BodyFragment(fact); FRAGMENTS.set(fragment.fact, fragment) }
  return fragment
}

function append<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  let values = map.get(key)
  if (!values) map.set(key, (values = []))
  values.push(value)
}

function snapshotFact(fact: TypeScriptFact<'body'>): TypeScriptFact<'body'> {
  // External providers may reuse mutable input objects. Own our data containers,
  // without freezing their objects or memoizing a fragment by the caller's identity.
  return snapshotData(fact)
}

function snapshotData<Value>(value: Value, seen = new Map<object, unknown>()): Value {
  if (!value || typeof value !== 'object') return value
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  const previous = seen.get(value)
  if (previous) return previous as Value
  const copy: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const [key, entry] of Object.entries(value)) Object.defineProperty(copy, key, {
    value: snapshotData(entry, seen), enumerable: true, writable: true, configurable: true,
  })
  return Object.freeze(copy) as Value
}

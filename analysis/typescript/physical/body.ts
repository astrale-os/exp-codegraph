import type { Fact } from '../../facts/index.ts'
import { ownFactPayloadCodec, ownFactPayloadIdentity, physicalPayloadForProjection, type FactPayloadCodec, type PhysicalPayloadRecord } from '../../facts/representation/index.ts'
import type {
  OccurrenceId,
  SourceId,
  SourceRevisionId,
  SymbolId,
} from '../../identity/index.ts'
import type { ValueResult } from '../value/model.ts'
import { validateFunctionBodyIR, type FunctionBodyIR } from '../body/model.ts'
import { PackedNumericRows, PackedOccurrenceRows } from './body-rows.ts'
import { preparePackedBodyIdentity } from './body-admission.ts'
import {
  admitCompleteness, admitValueResult, array, decodeBlock, decodeCall, decodeDefinition, decodeEdge,
  decodeOccurrence, decodeRelation, decodeSummary, exactRecord, exactTuple, expandId, ordinal, unique,
  uniqueStrings, type PackedBodyData,
} from './body-data.ts'

export const TYPESCRIPT_BODY_PAYLOAD_CODEC_ID = 'typescript.body.packed/6'

export const TYPESCRIPT_BODY_PAYLOAD_CODEC: FactPayloadCodec = ownFactPayloadIdentity(Object.freeze({
  id: TYPESCRIPT_BODY_PAYLOAD_CODEC_ID,
  decode: (input: unknown) => decodePackedTypeScriptBody(input, 6),
}), preparePackedBodyIdentity)

export const TYPESCRIPT_FACT_PAYLOAD_CODECS: readonly FactPayloadCodec[] = Object.freeze([
  TYPESCRIPT_BODY_PAYLOAD_CODEC,
  Object.freeze({
    id: 'typescript.body.packed/5',
    decode: (input: unknown) => decodePackedTypeScriptBody(input, 5),
  }),
  Object.freeze({
    id: 'typescript.body.packed/4',
    decode: (input: unknown) => decodePackedTypeScriptBody(input, 4),
  }),
  Object.freeze({
    id: 'typescript.body.packed/3',
    decode: (input: unknown) => decodePackedTypeScriptBody(input, 3),
  }),
  Object.freeze({
    id: 'typescript.body.packed/2',
    decode: (input: unknown) => decodePackedTypeScriptBody(input, 2),
  }),
  Object.freeze({
    id: 'typescript.body.packed/1',
    decode: (input: unknown) => decodePackedTypeScriptBody(input, 1),
  }),
].map(ownFactPayloadCodec))

function decodePackedTypeScriptBody(input: unknown, version: 1 | 2 | 3 | 4 | 5 | 6): unknown {
  const packed = exactRecord(input, ['c', 's', 't', 'p', 'o', 'r', 'b', 'e', 'd', 'a', 'u', 'v', 'q'], 'body payload') as unknown as PackedBodyData
  const constants = exactTuple(packed.c, version === 1 ? 3 : 5, 'constants')
  const scope = version === 1 ? undefined : constants[3]
  if (version >= 2 && scope !== 'function' && scope !== 'module') {
    throw new TypeError('Packed TypeScript body scope is invalid.')
  }
  const execution = version === 1 || constants[4] === '' ? undefined : constants[4]
  if (execution !== undefined && execution !== 'sync' && execution !== 'async' && execution !== 'generator' && execution !== 'async-generator') {
    throw new TypeError('Packed TypeScript body execution is invalid.')
  }
  const source = expandId(constants[0], 'source') as SourceId
  const revision = expandId(constants[1], 'source-revision') as SourceRevisionId
  const owner = expandId(constants[2], 'symbol') as SymbolId
  const symbols = uniqueStrings(packed.s, 'symbols').map(
    (entry) => expandId(entry, 'symbol') as SymbolId,
  )
  const texts = uniqueStrings(packed.t, 'texts')
  const symbol = (value: unknown, path: string): SymbolId =>
    symbols[ordinal(value, symbols.length, path)]!
  const text = (value: unknown, path: string): string =>
    texts[ordinal(value, texts.length, path)]!

  const occurrenceRows = new PackedOccurrenceRows(packed.o, version === 6)
  const scratch: unknown[] = []
  const occurrences = Array.from({ length: occurrenceRows.length }, (_, index) =>
    decodeOccurrence(occurrenceRows.row(index, scratch), index, version, source, revision, owner, symbols, texts))
  const occurrenceIds = occurrences.map((entry) => entry.id)
  unique(occurrenceIds, 'occurrence identities')
  const occurrence = (value: unknown, path: string): OccurrenceId =>
    occurrences[ordinal(value, occurrences.length, path)]!.id

  const parameters = Array.from(array(packed.p, 'parameters'), (entry, index) => symbol(entry, `parameters[${index}]`))
  const relationRows = new PackedNumericRows(packed.r, 3, version === 6, 'relations')
  const relations = Array.from({ length: relationRows.length }, (_, index) =>
    decodeRelation(relationRows.row(index, scratch), index, occurrence, text))
  const blocks = Array.from(array(packed.b, 'blocks'), (value, index) => decodeBlock(value, index, occurrence, text))
  unique(blocks.map((entry) => entry.id), 'block identities')
  const block = (value: unknown, path: string): string =>
    blocks[ordinal(value, blocks.length, path)]!.id
  const edgeRows = new PackedNumericRows(packed.e, 4, version === 6, 'edges')
  const edges = Array.from({ length: edgeRows.length }, (_, index) =>
    decodeEdge(edgeRows.row(index, scratch), index, occurrences.length, occurrenceIds, block, text))
  const definitionRows = new PackedNumericRows(packed.d, 4, version === 6, 'definitions')
  const definitions = Array.from({ length: definitionRows.length }, (_, index) =>
    decodeDefinition(definitionRows.row(index, scratch), index, symbols, occurrence, text))
  const calls = Array.from(array(packed.a, 'calls'), (value, index) =>
    decodeCall(value, index, version, symbols, texts, occurrences.length, occurrence))
  const summary = decodeSummary(packed.u, owner, occurrenceIds, symbol)
  const body: FunctionBodyIR = {
    ...(scope === undefined ? {} : { scope: scope as 'function' | 'module' }),
    ...(execution === undefined ? {} : { execution: execution as FunctionBodyIR['execution'] }),
    function: owner,
    parameters,
    occurrences,
    relations,
    blocks,
    edges,
    definitions,
    calls,
    summary,
  }
  const diagnostics = validateFunctionBodyIR(body)
  if (diagnostics.length) {
    throw new TypeError(`Packed TypeScript body is semantically invalid: ${diagnostics.join(', ')}`)
  }
  const values: Record<string, ValueResult<unknown>> = {}
  const valueOccurrences = new Set<number>()
  for (const [index, value] of packed.v.entries()) {
    const row = exactTuple(value, 2, `values[${index}]`)
    const key = ordinal(row[0], occurrences.length, `values[${index}].occurrence`)
    if (valueOccurrences.has(key)) throw new TypeError('Packed TypeScript body repeats a value occurrence.')
    valueOccurrences.add(key)
    values[occurrences[key]!.id] = admitValueResult(row[1], `values[${index}].value`)
  }
  return { body, values, completeness: admitCompleteness(packed.q, 'completeness') }
}

/** Private column view; creation requires the exact admitted, owned physical state. */
export class PackedTypeScriptBodyProjection {
  readonly record: PhysicalPayloadRecord
  readonly owner: SymbolId
  readonly source: SourceId
  readonly revision: SourceRevisionId
  readonly occurrences: readonly OccurrenceId[]
  readonly calls: readonly number[]
  readonly effectCandidates: readonly number[]
  readonly #packed: PackedBodyData
  readonly #version: number
  readonly #occurrenceRows: PackedOccurrenceRows
  readonly #relationsTable: PackedNumericRows
  readonly #definitionsTable: PackedNumericRows
  readonly #symbols: readonly SymbolId[]
  readonly #texts: readonly string[]
  readonly #nodes = new Map<number, FunctionBodyIR['occurrences'][number]>()
  readonly #resolvedCalls = new Map<number, FunctionBodyIR['calls'][number]>()
  #children: Uint32Array | undefined
  #parents: Uint32Array | undefined
  #definitions: Uint32Array | undefined
  #definite: Uint8Array | undefined
  #values: ReadonlyMap<number, ValueResult<unknown>> | undefined

  constructor(record: PhysicalPayloadRecord, version: number) {
    this.record = record
    this.#packed = record.data as PackedBodyData
    this.#version = version
    const packed = this.#packed
    this.#occurrenceRows = new PackedOccurrenceRows(packed.o, version === 6)
    this.#relationsTable = new PackedNumericRows(packed.r, 3, version === 6, 'relations')
    this.#definitionsTable = new PackedNumericRows(packed.d, 4, version === 6, 'definitions')
    this.owner = expandId(packed.c[2], 'symbol') as SymbolId
    this.source = expandId(packed.c[0], 'source') as SourceId
    this.revision = expandId(packed.c[1], 'source-revision') as SourceRevisionId
    this.#symbols = (packed.s as string[]).map((entry) => expandId(entry, 'symbol') as SymbolId)
    this.#texts = packed.t as string[]
    this.occurrences = Array.from({ length: this.#occurrenceRows.length }, (_, row) =>
      expandId(this.#occurrenceRows.field(row, 0), 'occurrence') as OccurrenceId)
    this.calls = (packed.a as number[][]).map((row) => row[0]!)
    const effects: number[] = []
    for (let row = 0; row < this.#occurrenceRows.length; row++) {
      const syntax = this.#texts[this.#occurrenceRows.field(row, 4) as number]
      if (syntax === 'VariableDeclaration' || syntax === 'DeleteExpression' ||
        this.#texts[this.#occurrenceRows.field(row, 1) as number] === 'assignment') effects.push(row)
    }
    this.effectCandidates = effects
  }

  effectNode(index: number): Pick<FunctionBodyIR['occurrences'][number], 'id' | 'kind' | 'syntax' | 'symbol' | 'owner'> {
    const rows = this.#occurrenceRows
    const symbol = rows.field(index, 5) as number
    return { id: this.occurrences[index]!, owner: this.owner,
      kind: this.#texts[rows.field(index, 1) as number] as FunctionBodyIR['occurrences'][number]['kind'],
      syntax: this.#texts[rows.field(index, 4) as number]!, ...(symbol === -1 ? {} : { symbol: this.#symbols[symbol] }) }
  }

  effectCall(index: number): Pick<FunctionBodyIR['calls'][number], 'occurrence' | 'target' | 'dynamic' | 'arguments' | 'bindings'> {
    const row = this.#packed.a[index] as unknown[]
    return { occurrence: this.occurrences[row[0] as number]!,
      ...(row[1] === -1 ? {} : { target: this.#symbols[row[1] as number] }), dynamic: row[8] === 1,
      arguments: (row[5] as number[]).map((value) => this.occurrences[value]!),
      bindings: (row[6] as number[][]).map((binding) => ({ argument: this.occurrences[binding[0]!]!,
        ...(binding[1] === -1 ? {} : { parameter: this.#symbols[binding[1]!] }), index: binding[2]!, rest: binding[3] === 1 })) }
  }

  occurrence(index: number): FunctionBodyIR['occurrences'][number] {
    let value = this.#nodes.get(index)
    if (!value) {
      value = freezeProjection(decodeOccurrence(this.#occurrenceRows.row(index, []), index, this.#version,
        this.source, this.revision, this.owner, this.#symbols, this.#texts))
      this.#nodes.set(index, value)
    }
    return value
  }

  call(index: number): FunctionBodyIR['calls'][number] {
    let value = this.#resolvedCalls.get(index)
    if (!value) {
      value = freezeProjection(decodeCall(this.#packed.a[index], index, this.#version, this.#symbols, this.#texts,
        this.occurrences.length, (ordinal) => this.occurrences[ordinal as number]!))
      this.#resolvedCalls.set(index, value)
    }
    return value
  }

  children(index: number): ReadonlyMap<string, OccurrenceId> | undefined {
    this.relations()
    if (!Number.isInteger(index) || index < 0 || index >= this.occurrences.length) return undefined
    const rows = this.#children!
    const end = rows[index + 1]
    if (rows[index] === end) return undefined
    const children = new Map<string, OccurrenceId>()
    const base = this.occurrences.length + 1
    for (let cursor = rows[index]!; cursor < end!; cursor++) {
      const row = rows[base + cursor]!
      children.set(this.#texts[this.#relationsTable.field(row, 2)]!, this.occurrences[this.#relationsTable.field(row, 1)]!)
    }
    return children
  }

  parents(index: number): readonly { parent: OccurrenceId; role: string }[] | undefined {
    this.relations()
    if (!Number.isInteger(index) || index < 0 || index >= this.occurrences.length) return undefined
    const rows = this.#parents!
    const end = rows[index + 1]
    if (rows[index] === end) return undefined
    const parents = []
    const base = this.occurrences.length + 1
    for (let cursor = rows[index]!; cursor < end!; cursor++) {
      const row = rows[base + cursor]!
      parents.push({ parent: this.occurrences[this.#relationsTable.field(row, 0)]!, role: this.#texts[this.#relationsTable.field(row, 2)]! })
    }
    return parents
  }

  definitions(index: number): readonly OccurrenceId[] | undefined {
    this.definitionRows()
    if (!Number.isInteger(index) || index < 0 || index >= this.occurrences.length) return undefined
    const rows = this.#definitions!
    const end = rows[index + 1]
    if (rows[index] === end) return undefined
    const definitions = []
    const base = this.occurrences.length + 1
    for (let cursor = rows[index]!; cursor < end!; cursor++) {
      const row = rows[base + cursor]!
      definitions.push(this.occurrences[this.#definitionsTable.field(row, 0)]!)
    }
    return definitions
  }

  definite(index: number): boolean {
    this.definitionRows()
    return Number.isInteger(index) && index >= 0 && index < this.occurrences.length &&
      (this.#definite![index >>> 3]! & (1 << (index & 7))) !== 0
  }

  value(index: number): ValueResult<unknown> | undefined {
    this.#values ??= new Map((this.#packed.v as [number, unknown][]).map(([key, value], index) =>
      [key, freezeProjection(admitValueResult(value, `values[${index}].value`))]))
    return this.#values.get(index)
  }

  private relations(): void {
    if (this.#children) return
    const rows = this.#relationsTable
    const children = indexBodyRows(rows, this.occurrences.length, 0)
    if (rows.length) {
      // Collapse repeated roles once, retaining their first position and last
      // child. Reads then visit only the requested children, even for a wide
      // bucket with many replacements of the same role.
      const positions = new Uint32Array(this.#texts.length)
      const owners = new Uint32Array(this.#texts.length)
      const base = this.occurrences.length + 1
      let cursor = 0
      for (let parent = 0; parent < this.occurrences.length; parent++) {
        const start = children[parent]!, end = children[parent + 1]!
        children[parent] = cursor
        for (let entry = start; entry < end; entry++) {
          const row = children[base + entry]!, role = rows.field(row, 2)
          if (owners[role] !== parent + 1) {
            owners[role] = parent + 1
            positions[role] = cursor++
          }
          children[base + positions[role]!] = row
        }
      }
      children[this.occurrences.length] = cursor
    }
    const parents = indexBodyRows(rows, this.occurrences.length, 1)
    this.#children = children
    this.#parents = parents
  }

  private definitionRows(): void {
    if (this.#definitions) return
    const rows = this.#definitionsTable
    const definite = new Uint8Array(rows.length ? Math.ceil(this.occurrences.length / 8) : 0)
    for (let row = 0; row < rows.length; row++) {
      const use = rows.field(row, 1)
      if (this.#texts[rows.field(row, 3)] === 'definite') definite[use >>> 3]! |= 1 << (use & 7)
    }
    this.#definitions = indexBodyRows(rows, this.occurrences.length, 1)
    this.#definite = definite
  }
}

// The first occurrenceCount + 1 entries delimit stable buckets in the remaining
// row ordinals. Reverse scatter turns cumulative ends into starts in place, so
// construction needs no cursor array or per-link objects. Only admitted local
// ordinals enter this index. Packed rows are never mutated; buffers stay private
// to the projection owned by that exact admitted physical record.
function indexBodyRows(rows: PackedNumericRows, occurrenceCount: number, key: 0 | 1): Uint32Array {
  if (!rows.length) return new Uint32Array(0)
  const base = occurrenceCount + 1
  const index = new Uint32Array(base + rows.length)
  for (let row = 0; row < rows.length; row++) index[rows.field(row, key)]!++
  let end = 0
  for (let occurrence = 0; occurrence < occurrenceCount; occurrence++) {
    end += index[occurrence]!
    index[occurrence] = end
  }
  index[occurrenceCount] = rows.length
  for (let row = rows.length - 1; row >= 0; row--) {
    const cursor = --index[rows.field(row, key)]!
    index[base + cursor] = row
  }
  return index
}

const BODY_PROJECTIONS = new WeakMap<PhysicalPayloadRecord, PackedTypeScriptBodyProjection>()
export function projectPackedTypeScriptBody(fact: Fact): PackedTypeScriptBodyProjection | undefined {
  for (let index = 0; index < TYPESCRIPT_FACT_PAYLOAD_CODECS.length; index++) {
    const record = physicalPayloadForProjection(fact, TYPESCRIPT_FACT_PAYLOAD_CODECS[index]!)
    if (!record) continue
    let projection = BODY_PROJECTIONS.get(record)
    if (!projection) {
      projection = new PackedTypeScriptBodyProjection(record, 6 - index)
      BODY_PROJECTIONS.set(record, projection)
    }
    return projection
  }
  return undefined
}

function freezeProjection<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeProjection(entry)
    Object.freeze(value)
  }
  return value
}

import type { OwnedPayloadIdentity, OwnedPayloadIdentityWriter } from '../../facts/representation/index.ts'
import type { OccurrenceId, SourceId, SourceRevisionId, SymbolId } from '../../identity/index.ts'
import type { FunctionBodyIR } from '../body/model.ts'
import { validateBodyView, type BodyValidationView } from '../body/validation.ts'
import type { ValueResult } from '../value/model.ts'
import {
  admitCompleteness, admitValueResult, array, createOccurrenceScratch, decodeBlock, decodeCall, decodeDefinition, decodeEdge,
  decodeOccurrence, decodeRelation, decodeSummary, exactRecord, exactTuple, expandId, ordinal,
  unique, uniqueStrings, type DefinitionScratch, type EdgeScratch, type PackedBodyData,
} from './body-data.ts'
import { PackedNumericRows, PackedOccurrenceRows } from './body-rows.ts'

/** Exact owned /6 codec only. Validate every field before exposing an emitter. */
export function preparePackedBodyIdentity(input: unknown): OwnedPayloadIdentity {
  const packed = exactRecord(input, ['c', 's', 't', 'p', 'o', 'r', 'b', 'e', 'd', 'a', 'u', 'v', 'q'], 'body payload') as unknown as PackedBodyData
  const constants = exactTuple(packed.c, 5, 'constants')
  const scope = constants[3]
  if (scope !== 'function' && scope !== 'module') throw new TypeError('Packed TypeScript body scope is invalid.')
  const execution = constants[4] === '' ? undefined : constants[4]
  if (execution !== undefined && execution !== 'sync' && execution !== 'async' && execution !== 'generator' && execution !== 'async-generator') {
    throw new TypeError('Packed TypeScript body execution is invalid.')
  }
  const source = expandId(constants[0], 'source') as SourceId
  const revision = expandId(constants[1], 'source-revision') as SourceRevisionId
  const owner = expandId(constants[2], 'symbol') as SymbolId
  const symbols = uniqueStrings(packed.s, 'symbols').map(entry => expandId(entry, 'symbol') as SymbolId)
  const texts = uniqueStrings(packed.t, 'texts')
  const symbol = (value: unknown, path: string): SymbolId => symbols[ordinal(value, symbols.length, path)]!
  const text = (value: unknown, path: string): string => texts[ordinal(value, texts.length, path)]!

  // The structural pass follows the decoder's order, including optional fields
  // validated before required references. Only normalized dictionaries and open
  // fragments survive; occurrence objects and spans reuse one local scratch.
  const occurrenceRows = new PackedOccurrenceRows(packed.o, true)
  const scratch: unknown[] = []
  const occurrenceIds: OccurrenceId[] = []
  const origins: (FunctionBodyIR['occurrences'][number]['symbolOrigin'])[] = []
  const node = createOccurrenceScratch(source, revision, owner)
  for (let index = 0; index < occurrenceRows.length; index++) {
    decodeOccurrence(occurrenceRows.row(index, scratch), index, 6, source, revision, owner, symbols, texts, node)
    occurrenceIds.push(node.id)
    origins.push(node.symbolOrigin)
  }
  unique(occurrenceIds, 'occurrence identities')
  const occurrence = (value: unknown, path: string): OccurrenceId => occurrenceIds[ordinal(value, occurrenceIds.length, path)]!
  const parameters = Array.from(array(packed.p, 'parameters'), (entry, index) => symbol(entry, `parameters[${index}]`))
  const relationRows = new PackedNumericRows(packed.r, 3, true, 'relations')
  const relation = { parent: '' as OccurrenceId, child: '' as OccurrenceId, role: '' }
  for (let index = 0; index < relationRows.length; index++) {
    decodeRelation(relationRows.row(index, scratch), index, occurrence, text, relation)
  }
  const blocks = array(packed.b, 'blocks')
  const blockIds = Array.from(blocks, (value, index) => decodeBlock(value, index, occurrence, text).id)
  unique(blockIds, 'block identities')
  const block = (value: unknown, path: string): string => blockIds[ordinal(value, blockIds.length, path)]!
  const edgeRows = new PackedNumericRows(packed.e, 4, true, 'edges')
  const edge: EdgeScratch = { from: '', to: '', kind: 'fallthrough', evidence: undefined }
  for (let index = 0; index < edgeRows.length; index++) {
    decodeEdge(edgeRows.row(index, scratch), index, occurrenceIds.length, occurrenceIds, block, text, edge)
  }
  const definitionRows = new PackedNumericRows(packed.d, 4, true, 'definitions')
  const definition: DefinitionScratch = { definition: '' as OccurrenceId, use: '' as OccurrenceId, symbol: undefined, reaching: 'definite' }
  for (let index = 0; index < definitionRows.length; index++) {
    decodeDefinition(definitionRows.row(index, scratch), index, symbols, occurrence, text, definition)
  }
  const calls = array(packed.a, 'calls')
  const targetOrigins = Array.from(calls, (value, index) =>
    decodeCall(value, index, 6, symbols, texts, occurrenceIds.length, occurrence).targetOrigin)
  const summary = decodeSummary(packed.u, owner, occurrenceIds, symbol)

  // Semantic validation shares the logical validator's complete rules. IDs are
  // supplied directly, so constructing its Sets never materializes row objects.
  // These views are consumed synchronously and never escape preparation.
  const view: BodyValidationView = {
    scope, ...(execution === undefined ? {} : { execution }), function: owner, parameters, summary,
    occurrences: rows(occurrenceRows.length, function* () {
      const row: unknown[] = []
      const value = createOccurrenceScratch(source, revision, owner)
      for (let index = 0; index < occurrenceRows.length; index++) {
        const fields = occurrenceRows.row(index, row) as readonly number[]
        value.id = occurrenceIds[index]!
        value.kind = texts[fields[1]!]! as typeof value.kind
        value.span.start = fields[2]!
        value.span.end = fields[3]!
        value.syntax = texts[fields[4]!]!
        value.symbol = fields[5] === -1 ? undefined : symbols[fields[5]!]!
        value.symbolOrigin = origins[index]
        value.operator = fields[7] === -1 ? undefined : texts[fields[7]!]!
        value.symbolKind = fields[8] === -1 ? undefined : texts[fields[8]!]! as typeof value.symbolKind
        value.propertyName = fields[9] === -1 ? undefined : texts[fields[9]!]!
        value.propertyNamespace = fields[10] === -1 ? undefined : symbols[fields[10]!]!
        yield value as FunctionBodyIR['occurrences'][number]
      }
    }),
    blocks: rows(blocks.length, function* () {
      for (let index = 0; index < blocks.length; index++) {
        const row = blocks[index] as readonly unknown[]
        yield { id: blockIds[index]!, occurrences: references(row[1] as readonly number[], occurrenceIds) }
      }
    }),
    relations: rows(relationRows.length, function* () {
      const scratch: unknown[] = []
      for (let index = 0; index < relationRows.length; index++) {
        const row = relationRows.row(index, scratch) as readonly number[]
        yield { parent: occurrenceIds[row[0]!]!, child: occurrenceIds[row[1]!]!, role: texts[row[2]!]! }
      }
    }),
    edges: rows(edgeRows.length, function* () {
      const scratch: unknown[] = []
      for (let index = 0; index < edgeRows.length; index++) {
        const row = edgeRows.row(index, scratch) as readonly number[]
        yield { from: blockIds[row[0]!]!, to: blockIds[row[1]!]!, kind: texts[row[2]!]! as FunctionBodyIR['edges'][number]['kind'],
          ...(row[3] === -1 ? {} : { evidence: occurrenceIds[row[3]!]! }) }
      }
    }),
    definitions: rows(definitionRows.length, function* () {
      const scratch: unknown[] = []
      for (let index = 0; index < definitionRows.length; index++) {
        const row = definitionRows.row(index, scratch) as readonly number[]
        yield { definition: occurrenceIds[row[0]!]!, use: occurrenceIds[row[1]!]!, reaching: texts[row[3]!]! as FunctionBodyIR['definitions'][number]['reaching'] }
      }
    }),
    calls: rows(calls.length, function* () {
      for (let index = 0; index < calls.length; index++) {
        const row = calls[index] as readonly unknown[]
        yield {
          occurrence: occurrenceIds[row[0] as number]!,
          ...(row[1] === -1 ? {} : { target: symbols[row[1] as number]! }),
          ...(targetOrigins[index] === undefined ? {} : { targetOrigin: targetOrigins[index]! }),
          ...(row[3] === -1 ? {} : { receiver: occurrenceIds[row[3] as number]! }),
          typeArguments: (row[4] as readonly number[]).map(value => texts[value]!),
          arguments: references(row[5] as readonly number[], occurrenceIds),
          bindings: bindingViews(row[6] as readonly (readonly number[])[], occurrenceIds, symbols),
          dynamic: row[8] === 1,
        }
      }
    }),
  }
  const diagnostics = validateBodyView(view, { occurrences: occurrenceIds, blocks: blockIds })
  if (diagnostics.length) throw new TypeError(`Packed TypeScript body is semantically invalid: ${diagnostics.join(', ')}`)

  // Values and completeness intentionally follow all IR diagnostics, matching
  // the ordinary decoder. Open fragments use its existing snapshot helpers.
  const values: [OccurrenceId, ValueResult<unknown>][] = []
  const valueOccurrences = new Set<number>()
  for (const [index, value] of packed.v.entries()) {
    const row = exactTuple(value, 2, `values[${index}]`)
    const key = ordinal(row[0], occurrenceIds.length, `values[${index}].occurrence`)
    if (valueOccurrences.has(key)) throw new TypeError('Packed TypeScript body repeats a value occurrence.')
    valueOccurrences.add(key)
    values.push([occurrenceIds[key]!, admitValueResult(row[1], `values[${index}].value`)])
  }
  const completeness = admitCompleteness(packed.q, 'completeness')
  // Expanded occurrence IDs are ASCII, non-index object keys. Their canonical
  // order is independent of the packed value rows and base64url dictionary order.
  values.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)

  return { write(writer) {
    writer.part('{"body":{"blocks":[')
    for (let index = 0; index < blocks.length; index++) {
      if (index) writer.part(',')
      const row = blocks[index] as readonly unknown[]
      writer.part('{"id":'); writer.value(blockIds[index]); writer.part(',"occurrences":')
      writeReferences(writer, row[1] as readonly number[], occurrenceIds)
      writer.part('}')
    }
    writer.part('],"calls":[')
    for (let index = 0; index < calls.length; index++) {
      if (index) writer.part(',')
      const row = calls[index] as readonly unknown[]
      writer.part('{"arguments":'); writeReferences(writer, row[5] as readonly number[], occurrenceIds)
      writer.part(',"bindings":[')
      const bindings = row[6] as readonly (readonly number[])[]
      for (let binding = 0; binding < bindings.length; binding++) {
        if (binding) writer.part(',')
        const fields = bindings[binding]!
        writer.part('{"argument":'); writer.value(occurrenceIds[fields[0]!])
        writer.part(',"index":'); writer.value(fields[2])
        if (fields[1] !== -1) { writer.part(',"parameter":'); writer.value(symbols[fields[1]!]) }
        writer.part(',"rest":'); writer.value(fields[3] === 1); writer.part('}')
      }
      writer.part('],"callbacks":'); writeReferences(writer, row[7] as readonly number[], symbols)
      writer.part(',"dynamic":'); writer.value(row[8] === 1)
      writer.part(',"occurrence":'); writer.value(occurrenceIds[row[0] as number])
      if (row[3] !== -1) { writer.part(',"receiver":'); writer.value(occurrenceIds[row[3] as number]) }
      if (row[2] !== -1) { writer.part(',"signature":'); writer.value(texts[row[2] as number]) }
      if (row[1] !== -1) { writer.part(',"target":'); writer.value(symbols[row[1] as number]) }
      if (targetOrigins[index] !== undefined) { writer.part(',"targetOrigin":'); writer.value(targetOrigins[index]) }
      writer.part(',"typeArguments":'); writeReferences(writer, row[4] as readonly number[], texts)
      writer.part('}')
    }
    writer.part('],"definitions":[')
    for (let index = 0; index < definitionRows.length; index++) {
      if (index) writer.part(',')
      const row = definitionRows.row(index, scratch) as readonly number[]
      writer.part('{"definition":'); writer.value(occurrenceIds[row[0]!])
      writer.part(',"reaching":'); writer.value(texts[row[3]!])
      if (row[2] !== -1) { writer.part(',"symbol":'); writer.value(symbols[row[2]!]) }
      writer.part(',"use":'); writer.value(occurrenceIds[row[1]!]); writer.part('}')
    }
    writer.part('],"edges":[')
    for (let index = 0; index < edgeRows.length; index++) {
      if (index) writer.part(',')
      const row = edgeRows.row(index, scratch) as readonly number[]
      writer.part('{')
      if (row[3] !== -1) { writer.part('"evidence":'); writer.value(occurrenceIds[row[3]!]); writer.part(',') }
      writer.part('"from":'); writer.value(blockIds[row[0]!])
      writer.part(',"kind":'); writer.value(texts[row[2]!])
      writer.part(',"to":'); writer.value(blockIds[row[1]!]); writer.part('}')
    }
    writer.part(']')
    if (execution !== undefined) { writer.part(',"execution":'); writer.value(execution) }
    writer.part(',"function":'); writer.value(owner)
    writer.part(',"occurrences":[')
    for (let index = 0; index < occurrenceRows.length; index++) {
      if (index) writer.part(',')
      const row = occurrenceRows.row(index, scratch) as readonly number[]
      writer.part('{"id":'); writer.value(occurrenceIds[index])
      writer.part(',"kind":'); writer.value(texts[row[1]!])
      if (row[7] !== -1) { writer.part(',"operator":'); writer.value(texts[row[7]!]) }
      writer.part(',"owner":'); writer.value(owner)
      if (row[9] !== -1) { writer.part(',"propertyName":'); writer.value(texts[row[9]!]) }
      if (row[10] !== -1) { writer.part(',"propertyNamespace":'); writer.value(symbols[row[10]!]) }
      writer.part(',"span":{"end":'); writer.value(row[3])
      writer.part(',"revision":'); writer.value(revision)
      writer.part(',"source":'); writer.value(source)
      writer.part(',"start":'); writer.value(row[2]); writer.part('}')
      if (row[5] !== -1) { writer.part(',"symbol":'); writer.value(symbols[row[5]!]) }
      if (row[8] !== -1) { writer.part(',"symbolKind":'); writer.value(texts[row[8]!]) }
      if (origins[index] !== undefined) { writer.part(',"symbolOrigin":'); writer.value(origins[index]) }
      writer.part(',"syntax":'); writer.value(texts[row[4]!]); writer.part('}')
    }
    writer.part('],"parameters":'); writer.value(parameters)
    writer.part(',"relations":[')
    for (let index = 0; index < relationRows.length; index++) {
      if (index) writer.part(',')
      const row = relationRows.row(index, scratch) as readonly number[]
      writer.part('{"child":'); writer.value(occurrenceIds[row[1]!])
      writer.part(',"parent":'); writer.value(occurrenceIds[row[0]!])
      writer.part(',"role":'); writer.value(texts[row[2]!]); writer.part('}')
    }
    writer.part('],"scope":'); writer.value(scope)
    writer.part(',"summary":'); writer.value(summary)
    writer.part('},"completeness":'); writer.value(completeness)
    writer.part(',"values":{')
    for (let index = 0; index < values.length; index++) {
      if (index) writer.part(',')
      writer.value(values[index]![0]); writer.part(':'); writer.value(values[index]![1])
    }
    writer.part('}}')
  } }
}

function rows<Value>(length: number, iterate: () => Iterator<Value>): Iterable<Value> & { readonly length: number } {
  return { length, [Symbol.iterator]: iterate }
}

function* references<Value>(indices: readonly number[], values: readonly Value[]): Iterable<Value> {
  for (const index of indices) yield values[index]!
}

function* bindingViews(rows: readonly (readonly number[])[], occurrences: readonly OccurrenceId[], symbols: readonly SymbolId[]): Iterable<FunctionBodyIR['calls'][number]['bindings'][number]> {
  for (const row of rows) yield { argument: occurrences[row[0]!]!,
    ...(row[1] === -1 ? {} : { parameter: symbols[row[1]!]! }), index: row[2]!, rest: row[3] === 1 }
}

function writeReferences<Value>(writer: OwnedPayloadIdentityWriter, indices: readonly number[], values: readonly Value[]): void {
  writer.part('[')
  for (let index = 0; index < indices.length; index++) {
    if (index) writer.part(',')
    writer.value(values[indices[index]!]!)
  }
  writer.part(']')
}

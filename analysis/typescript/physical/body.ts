import type {
  AnalysisFailure,
  AnalysisLimit,
  Completeness,
  Fact,
} from '../../facts/index.ts'
import { ownFactPayloadCodec, physicalPayloadForProjection, type FactPayloadCodec, type PhysicalPayloadRecord } from '../../facts/representation/index.ts'
import type {
  FactId,
  OccurrenceId,
  PassId,
  SourceId,
  SourceRevisionId,
  SymbolId,
} from '../../identity/index.ts'
import type { ValueResult } from '../value/model.ts'
import { validateFunctionBodyIR, type FunctionBodyIR } from '../body/model.ts'

export const TYPESCRIPT_BODY_PAYLOAD_CODEC_ID = 'typescript.body.packed/5'

export const TYPESCRIPT_BODY_PAYLOAD_CODEC: FactPayloadCodec = Object.freeze({
  id: TYPESCRIPT_BODY_PAYLOAD_CODEC_ID,
  decode: (input: unknown) => decodePackedTypeScriptBody(input, 5),
})

export const TYPESCRIPT_FACT_PAYLOAD_CODECS: readonly FactPayloadCodec[] = Object.freeze([
  TYPESCRIPT_BODY_PAYLOAD_CODEC,
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

interface PackedBodyData {
  readonly c: readonly unknown[]
  readonly s: readonly unknown[]
  readonly t: readonly unknown[]
  readonly p: readonly unknown[]
  readonly o: readonly unknown[]
  readonly r: readonly unknown[]
  readonly b: readonly unknown[]
  readonly e: readonly unknown[]
  readonly d: readonly unknown[]
  readonly a: readonly unknown[]
  readonly u: readonly unknown[]
  readonly v: readonly unknown[]
  readonly q: unknown
}

function decodePackedTypeScriptBody(input: unknown, version: 1 | 2 | 3 | 4 | 5): unknown {
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

  const occurrences = Array.from(array(packed.o, 'occurrences'), (value, index) =>
    decodeOccurrence(value, index, version, source, revision, owner, symbols, texts))
  unique(occurrences.map((entry) => entry.id), 'occurrence identities')
  const occurrence = (value: unknown, path: string): OccurrenceId =>
    occurrences[ordinal(value, occurrences.length, path)]!.id

  const parameters = Array.from(array(packed.p, 'parameters'), (entry, index) => symbol(entry, `parameters[${index}]`))
  const relations = Array.from(array(packed.r, 'relations'), (value, index) => {
    const row = exactTuple(value, 3, `relations[${index}]`)
    return {
      parent: occurrence(row[0], `relations[${index}].parent`),
      child: occurrence(row[1], `relations[${index}].child`),
      role: text(row[2], `relations[${index}].role`),
    }
  })
  const blocks = Array.from(array(packed.b, 'blocks'), (value, index) => {
    const row = exactTuple(value, 2, `blocks[${index}]`)
    return {
      id: text(row[0], `blocks[${index}].id`),
      occurrences: Array.from(array(row[1], `blocks[${index}].occurrences`), (entry, occurrenceIndex) =>
        occurrence(entry, `blocks[${index}].occurrences[${occurrenceIndex}]`),
      ),
    }
  })
  unique(blocks.map((entry) => entry.id), 'block identities')
  const block = (value: unknown, path: string): string =>
    blocks[ordinal(value, blocks.length, path)]!.id
  const edges = Array.from(array(packed.e, 'edges'), (value, index) => {
    const row = exactTuple(value, 4, `edges[${index}]`)
    const evidence = optionalOrdinal(row[3], occurrences.length, `edges[${index}].evidence`)
    return {
      from: block(row[0], `edges[${index}].from`),
      to: block(row[1], `edges[${index}].to`),
      kind: text(row[2], `edges[${index}].kind`),
      ...(evidence === undefined ? {} : { evidence: occurrences[evidence]!.id }),
    }
  }) as FunctionBodyIR['edges']
  const definitions = Array.from(array(packed.d, 'definitions'), (value, index) => {
    const row = exactTuple(value, 4, `definitions[${index}]`)
    const definitionSymbol = optionalOrdinal(row[2], symbols.length, `definitions[${index}].symbol`)
    return {
      definition: occurrence(row[0], `definitions[${index}].definition`),
      use: occurrence(row[1], `definitions[${index}].use`),
      ...(definitionSymbol === undefined ? {} : { symbol: symbols[definitionSymbol]! }),
      reaching: text(row[3], `definitions[${index}].reaching`),
    }
  }) as FunctionBodyIR['definitions']
  const calls = Array.from(array(packed.a, 'calls'), (value, index) =>
    decodeCall(value, index, version, symbols, texts, occurrences.length, occurrence))
  const summary = exactTuple(packed.u, 6, 'summary')
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
    summary: {
      function: owner,
      returns: occurrenceArray(summary[0], occurrences, 'summary.returns'),
      throws: occurrenceArray(summary[1], occurrences, 'summary.throws'),
      captures: Array.from(array(summary[2], 'summary.captures'), (entry, index) =>
        symbol(entry, `summary.captures[${index}]`),
      ),
      calls: occurrenceArray(summary[3], occurrences, 'summary.calls'),
      escapes: occurrenceArray(summary[4], occurrences, 'summary.escapes'),
      recursion: bit(summary[5], 'summary.recursion'),
    },
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

function decodeOccurrence(value: unknown, index: number, version: number,
  source: SourceId, revision: SourceRevisionId, owner: SymbolId,
  symbols: readonly SymbolId[], texts: readonly string[]): FunctionBodyIR['occurrences'][number] {
  const text = (value: unknown, path: string): string => texts[ordinal(value, texts.length, path)]!
  const row = exactTuple(value, version >= 5 ? 11 : version >= 4 ? 8 : version >= 3 ? 7 : 6, `occurrences[${index}]`)
  const symbolIndex = optionalOrdinal(row[5], symbols.length, `occurrences[${index}].symbol`)
  const operatorIndex = version < 4 ? undefined : optionalOrdinal(row[7], texts.length, `occurrences[${index}].operator`)
  const symbolKindIndex = version < 5 ? undefined : optionalOrdinal(row[8], texts.length, `occurrences[${index}].symbolKind`)
  const propertyNameIndex = version < 5 ? undefined : optionalOrdinal(row[9], texts.length, `occurrences[${index}].propertyName`)
  const propertyNamespaceIndex = version < 5 ? undefined : optionalOrdinal(row[10], symbols.length, `occurrences[${index}].propertyNamespace`)
  return {
    id: expandId(row[0], 'occurrence') as OccurrenceId,
    kind: text(row[1], `occurrences[${index}].kind`),
    span: {
      source,
      revision,
      start: integer(row[2], 0, `occurrences[${index}].start`),
      end: integer(row[3], 1, `occurrences[${index}].end`),
    },
    owner,
    syntax: text(row[4], `occurrences[${index}].syntax`),
    ...(symbolIndex === undefined ? {} : { symbol: symbols[symbolIndex]! }),
    ...(version < 3 || row[6] === null ? {} : { symbolOrigin: admitSymbolOrigin(row[6]) }),
    ...(operatorIndex === undefined ? {} : { operator: texts[operatorIndex]! }),
    ...(symbolKindIndex === undefined ? {} : { symbolKind: texts[symbolKindIndex]! }),
    ...(propertyNameIndex === undefined ? {} : { propertyName: texts[propertyNameIndex]! }),
    ...(propertyNamespaceIndex === undefined ? {} : { propertyNamespace: symbols[propertyNamespaceIndex]! }),
  } as FunctionBodyIR['occurrences'][number]
}

function decodeCall(value: unknown, index: number, version: number,
  symbols: readonly SymbolId[], texts: readonly string[], occurrenceCount: number,
  occurrence: (value: unknown, path: string) => OccurrenceId): FunctionBodyIR['calls'][number] {
  const symbol = (value: unknown, path: string): SymbolId => symbols[ordinal(value, symbols.length, path)]!
  const text = (value: unknown, path: string): string => texts[ordinal(value, texts.length, path)]!
  const row = exactTuple(value, version === 1 ? 9 : 10, `calls[${index}]`)
  const target = optionalOrdinal(row[1], symbols.length, `calls[${index}].target`)
  const signature = optionalOrdinal(row[2], texts.length, `calls[${index}].signature`)
  const receiver = optionalOrdinal(row[3], occurrenceCount, `calls[${index}].receiver`)
  return {
    occurrence: occurrence(row[0], `calls[${index}].occurrence`),
    ...(target === undefined ? {} : { target: symbols[target]! }),
    ...(version === 1 || row[9] === null ? {} : { targetOrigin: admitSymbolOrigin(row[9]) }),
    ...(signature === undefined ? {} : { signature: texts[signature]! }),
    ...(receiver === undefined ? {} : { receiver: occurrence(receiver, `calls[${index}].receiver`) }),
    typeArguments: Array.from(array(row[4], `calls[${index}].typeArguments`), (entry, valueIndex) =>
      text(entry, `calls[${index}].typeArguments[${valueIndex}]`),
    ),
    arguments: Array.from(array(row[5], `calls[${index}].arguments`), (entry, valueIndex) =>
      occurrence(entry, `calls[${index}].arguments[${valueIndex}]`),
    ),
    bindings: Array.from(array(row[6], `calls[${index}].bindings`), (entry, bindingIndex) => {
      const binding = exactTuple(entry, 4, `calls[${index}].bindings[${bindingIndex}]`)
      const parameter = optionalOrdinal(
        binding[1],
        symbols.length,
        `calls[${index}].bindings[${bindingIndex}].parameter`,
      )
      return {
        argument: occurrence(
          binding[0],
          `calls[${index}].bindings[${bindingIndex}].argument`,
        ),
        ...(parameter === undefined ? {} : { parameter: symbols[parameter]! }),
        index: integer(binding[2], 0, `calls[${index}].bindings[${bindingIndex}].index`),
        rest: bit(binding[3], `calls[${index}].bindings[${bindingIndex}].rest`),
      }
    }),
    callbacks: Array.from(array(row[7], `calls[${index}].callbacks`), (entry, valueIndex) =>
      symbol(entry, `calls[${index}].callbacks[${valueIndex}]`),
    ),
    dynamic: bit(row[8], `calls[${index}].dynamic`),
  }
}

function admitSymbolOrigin(input: unknown): NonNullable<FunctionBodyIR['occurrences'][number]['symbolOrigin']> {
  const value = exactRecord(input, ['package', 'file', 'path'], 'symbol origin')
  if (typeof value.package !== 'string' || !value.package || typeof value.file !== 'string' || !value.file ||
    !Array.isArray(value.path) || !value.path.length || value.path.some((part) => typeof part !== 'string' || !part)) {
    throw new TypeError('Packed TypeScript symbol origin is invalid.')
  }
  return { package: value.package, file: value.file, path: Array.from(value.path as string[]) }
}

function admitCompleteness(value: unknown, path: string): Completeness {
  const input = record(value, path)
  if (input.kind === 'complete') {
    exactKeys(input, ['kind'], path)
    return { kind: 'complete' }
  }
  if (input.kind === 'partial') {
    exactKeys(input, ['kind', 'reasons'], path)
    return {
      kind: 'partial',
      reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) =>
        admitLimit(reason, `${path}.reasons[${index}]`),
      ),
    }
  }
  if (input.kind === 'unavailable') {
    exactKeys(input, ['kind', 'reasons'], path)
    return {
      kind: 'unavailable',
      reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) =>
        admitFailure(reason, `${path}.reasons[${index}]`),
      ),
    }
  }
  throw new TypeError(`Packed ${path}.kind is invalid.`)
}

function admitValueResult(value: unknown, path: string): ValueResult<unknown> {
  const input = record(value, path)
  const evidence = factIdentities(input.evidence, `${path}.evidence`)
  if (input.kind === 'known') {
    exactKeys(input, ['kind', 'value', 'evidence'], path)
    if (!Object.hasOwn(input, 'value')) throw new TypeError(`Packed ${path}.value is required.`)
    return { kind: 'known', value: ownedValue(input.value), evidence }
  }
  if (input.kind === 'unknown') {
    exactKeys(input, ['kind', 'reasons', 'evidence'], path)
    return {
      kind: 'unknown',
      reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) =>
        admitFailure(reason, `${path}.reasons[${index}]`),
      ),
      evidence,
    }
  }
  if (input.kind === 'ambiguous') {
    exactKeys(input, ['kind', 'values', 'reasons', 'evidence'], path)
    return {
      kind: 'ambiguous',
      values: Array.from(array(input.values, `${path}.values`), ownedValue),
      reasons: Array.from(array(input.reasons, `${path}.reasons`), (reason, index) =>
        admitLimit(reason, `${path}.reasons[${index}]`),
      ),
      evidence,
    }
  }
  if (input.kind === 'unsupported') {
    exactKeys(input, ['kind', 'construct', 'evidence'], path)
    if (typeof input.construct !== 'string' || !input.construct) {
      throw new TypeError(`Packed ${path}.construct is invalid.`)
    }
    return { kind: 'unsupported', construct: input.construct, evidence }
  }
  throw new TypeError(`Packed ${path}.kind is invalid.`)
}

function admitLimit(value: unknown, path: string): AnalysisLimit {
  const input = record(value, path)
  exactKeys(input, ['code', 'message', 'effective'], path)
  if (typeof input.code !== 'string' || !input.code || typeof input.message !== 'string' || !input.message) {
    throw new TypeError(`Packed ${path} has an invalid code or message.`)
  }
  const admitted = { ...record(input.effective, `${path}.effective`) }
  if (Object.values(admitted).some((entry) =>
    typeof entry !== 'number' && typeof entry !== 'string' && typeof entry !== 'boolean'
  )) throw new TypeError(`Packed ${path}.effective is invalid.`)
  const effective = admitted as Record<string, number | string | boolean>
  return { code: input.code, message: input.message, effective }
}

// The packed format is JSON data. Snapshot its open value fragments while decoding,
// so the owned output never retains an input container or a live accessor.
function ownedValue(value: unknown): unknown {
  if (typeof value === 'function') throw new TypeError('Packed values must be data.')
  if (value === null || typeof value !== 'object') return value
  return Array.isArray(value)
    ? Array.from(value, ownedValue)
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ownedValue(entry)]))
}

function admitFailure(value: unknown, path: string): AnalysisFailure {
  const input = record(value, path)
  const keys = input.attributableTo === undefined
    ? ['code', 'message', 'retryable']
    : ['code', 'message', 'attributableTo', 'retryable']
  exactKeys(input, keys, path)
  if (
    typeof input.code !== 'string' ||
    !input.code ||
    typeof input.message !== 'string' ||
    !input.message ||
    typeof input.retryable !== 'boolean' ||
    (input.attributableTo !== undefined && !analysisIdentity(input.attributableTo, 'pass'))
  ) throw new TypeError(`Packed ${path} is invalid.`)
  return {
    code: input.code,
    message: input.message,
    ...(input.attributableTo === undefined ? {} : { attributableTo: input.attributableTo as PassId }),
    retryable: input.retryable,
  }
}

function factIdentities(value: unknown, path: string): readonly FactId[] {
  return Array.from(array(value, path), (entry) => {
    if (!analysisIdentity(entry, 'fact')) throw new TypeError(`Packed ${path} is invalid.`)
    return entry as FactId
  })
}

function analysisIdentity(value: unknown, kind: string): boolean {
  return typeof value === 'string' && new RegExp(`^${kind}:[a-f0-9]{64}$`, 'u').test(value)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Packed ${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Packed ${path} fields are invalid.`)
  }
}

function occurrenceArray(
  value: unknown,
  occurrences: FunctionBodyIR['occurrences'],
  path: string,
): readonly OccurrenceId[] {
  return Array.from(array(value, path),
    (entry, index) => occurrences[ordinal(entry, occurrences.length, `${path}[${index}]`)]!.id,
  )
}

function expandId(value: unknown, kind: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new TypeError(`Packed ${kind} identity is invalid.`)
  }
  const digest = Buffer.from(value, 'base64url')
  if (digest.byteLength !== 32 || digest.toString('base64url') !== value) {
    throw new TypeError(`Packed ${kind} identity is not canonical.`)
  }
  return `${kind}:${digest.toString('hex')}`
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Packed ${path} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Packed ${path} fields are invalid.`)
  }
  return value as Record<string, unknown>
}

function exactTuple(value: unknown, length: number, path: string): readonly unknown[] {
  const tuple = array(value, path)
  if (tuple.length !== length) throw new TypeError(`Packed ${path} must have ${length} entries.`)
  return tuple
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Packed ${path} must be an array.`)
  return value
}

function uniqueStrings(values: readonly unknown[], path: string): readonly string[] {
  const copied = Array.from(array(values, path))
  if (copied.some((value) => typeof value !== 'string')) {
    throw new TypeError(`Packed ${path} must contain strings.`)
  }
  const result = copied as string[]
  unique(result, path)
  return result
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`Packed ${path} are duplicated.`)
}

function ordinal(value: unknown, length: number, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= length) {
    throw new TypeError(`Packed ${path} is outside its dictionary.`)
  }
  return Number(value)
}

function optionalOrdinal(value: unknown, length: number, path: string): number | undefined {
  if (value === -1) return undefined
  return ordinal(value, length, path)
}

function integer(value: unknown, minimum: number, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`Packed ${path} is not an integer >= ${minimum}.`)
  }
  return Number(value)
}

function bit(value: unknown, path: string): boolean {
  if (value !== 0 && value !== 1) throw new TypeError(`Packed ${path} must be 0 or 1.`)
  return value === 1
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
    this.owner = expandId(packed.c[2], 'symbol') as SymbolId
    this.source = expandId(packed.c[0], 'source') as SourceId
    this.revision = expandId(packed.c[1], 'source-revision') as SourceRevisionId
    this.#symbols = (packed.s as string[]).map((entry) => expandId(entry, 'symbol') as SymbolId)
    this.#texts = packed.t as string[]
    this.occurrences = (packed.o as unknown[][]).map((row) => expandId(row[0], 'occurrence') as OccurrenceId)
    this.calls = (packed.a as number[][]).map((row) => row[0]!)
    this.effectCandidates = (packed.o as unknown[][]).flatMap((row, index) =>
      this.#texts[row[4] as number] === 'VariableDeclaration' || this.#texts[row[4] as number] === 'DeleteExpression' ||
      this.#texts[row[1] as number] === 'assignment' ? [index] : [])
  }

  effectNode(index: number): Pick<FunctionBodyIR['occurrences'][number], 'id' | 'kind' | 'syntax' | 'symbol' | 'owner'> {
    const row = this.#packed.o[index] as unknown[]
    return { id: this.occurrences[index]!, owner: this.owner,
      kind: this.#texts[row[1] as number] as FunctionBodyIR['occurrences'][number]['kind'],
      syntax: this.#texts[row[4] as number]!, ...(row[5] === -1 ? {} : { symbol: this.#symbols[row[5] as number] }) }
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
      value = freezeProjection(decodeOccurrence(this.#packed.o[index], index, this.#version,
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
      const row = this.#packed.r[rows[base + cursor]!] as number[]
      children.set(this.#texts[row[2]!]!, this.occurrences[row[1]!]!)
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
      const row = this.#packed.r[rows[base + cursor]!] as number[]
      parents.push({ parent: this.occurrences[row[0]!]!, role: this.#texts[row[2]!]! })
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
      const row = this.#packed.d[rows[base + cursor]!] as number[]
      definitions.push(this.occurrences[row[0]!]!)
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
    const rows = this.#packed.r as number[][]
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
          const row = children[base + entry]!, role = rows[row]![2]!
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
    const rows = this.#packed.d as number[][]
    const definite = new Uint8Array(rows.length ? Math.ceil(this.occurrences.length / 8) : 0)
    for (const row of rows) {
      const use = row[1]!
      if (this.#texts[row[3]!] === 'definite') definite[use >>> 3]! |= 1 << (use & 7)
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
function indexBodyRows(rows: readonly (readonly number[])[], occurrenceCount: number, key: 0 | 1): Uint32Array {
  if (!rows.length) return new Uint32Array(0)
  const base = occurrenceCount + 1
  const index = new Uint32Array(base + rows.length)
  for (const row of rows) index[row[key]!]!++
  let end = 0
  for (let occurrence = 0; occurrence < occurrenceCount; occurrence++) {
    end += index[occurrence]!
    index[occurrence] = end
  }
  index[occurrenceCount] = rows.length
  for (let row = rows.length - 1; row >= 0; row--) {
    const cursor = --index[rows[row]![key]!]!
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
      projection = new PackedTypeScriptBodyProjection(record, 5 - index)
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

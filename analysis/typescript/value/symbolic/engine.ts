import { createHash } from 'node:crypto'
import type { FactId, OccurrenceId, SymbolId } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import type { BodyOccurrence, ResolvedCall } from '../../body/index.ts'
import { createTypeScriptFactReader, type TypeScriptFact } from '../../facts/index.ts'
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions, BoundedValueLimits, EvaluatedValueResult, ValueResult } from '../model.ts'
import { resolveBoundedValueLimits } from '../limits.ts'
import type { SymbolicCallModel, SymbolicValue, SymbolicValuePlan, SymbolicValueResolveOptions } from './model.ts'

type Environment<Atom> = ReadonlyMap<SymbolId, Reference<Atom>>
interface Reference<Atom> { readonly occurrence: OccurrenceId; readonly environment: Environment<Atom> }
type Body = TypeScriptFact<'body'>
type RuntimeValue<Atom> =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'atom'; readonly value: Atom }
  | { readonly kind: 'external'; readonly symbol: SymbolId; readonly symbolOrigin?: BodyOccurrence['symbolOrigin'] }
  | { readonly kind: 'function'; readonly body: Body; readonly environment: Environment<Atom> }
  | { readonly kind: 'object'; readonly properties: ReadonlyMap<string, Reference<Atom>>; readonly incomplete: boolean }
  | { readonly kind: 'alternatives'; readonly values: readonly RuntimeValue<Atom>[] }
  | { readonly kind: 'unknown'; readonly code: string; readonly reason: string }
  | { readonly kind: 'unsupported'; readonly construct: string }

interface Index {
  readonly bodies: ReadonlyMap<SymbolId, Body>
  readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>
  readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, OccurrenceId>>
  readonly parents: ReadonlyMap<OccurrenceId, readonly { parent: OccurrenceId; role: string }[]>
  readonly definitions: ReadonlyMap<OccurrenceId, readonly OccurrenceId[]>
  readonly initializers: ReadonlyMap<SymbolId, readonly OccurrenceId[]>
  readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>
  readonly direct: ReadonlyMap<OccurrenceId, ValueResult<unknown>>
  readonly symbols: ReadonlyMap<SymbolId, TypeScriptFact<'symbol'>>
  readonly fingerprints: ReadonlyMap<string, string>
  readonly evidence: ReadonlyMap<string, readonly FactId[]>
}

interface State {
  readonly limits: Readonly<Required<BoundedValueLimits>>
  readonly signal?: AbortSignal
  readonly dependencies: Set<string>
  readonly evidence: Set<FactId>
  readonly active: Map<OccurrenceId, Set<object>>
  steps: number
  exhausted?: Extract<RuntimeValue<never>, { kind: 'unknown' }>
}

type Plan<Atom> =
  | { readonly kind: 'value'; readonly occurrence: OccurrenceId }
  | { readonly kind: 'property'; readonly input: Plan<Atom>; readonly name: string }
  | { readonly kind: 'invoke'; readonly input: Plan<Atom> }

const PROOF = Symbol('Codegraph value proof')
interface ProofMetadata {
  readonly model: unknown
  readonly limits: string
  readonly dependencies: ReadonlyMap<string, string | undefined>
}
type Proof = { readonly [PROOF]?: ProofMetadata }
const UNDEFINED = Object.freeze({ kind: 'literal' as const, value: undefined })

/** Instance-local index owner, shared by every model attached to one pinned snapshot. */
export function createValueEvaluatorFactory(query: AnalysisQuery): <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>) => Promise<BoundedValueEvaluator<Atom>> {
  let pending: Promise<Index> | undefined
  return async <Atom = never>(options: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'> = {}) => {
    pending ??= indexFacts(query).catch((error) => { pending = undefined; throw error })
    return new Evaluator(await pending, options.call, resolveBoundedValueLimits(options.limits))
  }
}

class Evaluator<Atom> implements BoundedValueEvaluator<Atom> {
  readonly #index: Index
  readonly #model: SymbolicCallModel<Atom> | undefined
  readonly #limits: Readonly<Required<BoundedValueLimits>>

  constructor(index: Index, model: SymbolicCallModel<Atom> | undefined, limits: Readonly<Required<BoundedValueLimits>>) {
    this.#index = index
    this.#model = model
    this.#limits = limits
  }

  value(occurrence: OccurrenceId): SymbolicValuePlan<Atom> { return this.plan({ kind: 'value', occurrence }) }

  canReuse(proof: EvaluatedValueResult<unknown>): boolean {
    const metadata = (proof as Proof)[PROOF]
    return !!metadata && metadata.model === this.#model && metadata.limits === JSON.stringify(this.#limits) &&
      [...metadata.dependencies].every(([key, fingerprint]) => this.#index.fingerprints.get(key) === fingerprint)
  }

  async evaluate<Value = unknown>(occurrence: OccurrenceId, options: { readonly signal?: AbortSignal } = {}): Promise<EvaluatedValueResult<Value>> {
    return this.resolve({ kind: 'value', occurrence }, options, true) as EvaluatedValueResult<Value>
  }

  private plan(node: Plan<Atom>): SymbolicValuePlan<Atom> {
    const plan: SymbolicValuePlan<Atom> = Object.freeze({
      property: (name: string) => this.plan({ kind: 'property', input: node, name }),
      invoke: () => this.plan({ kind: 'invoke', input: node }),
      resolve: async (options: SymbolicValueResolveOptions = {}) => this.resolve(node, options, false) as EvaluatedValueResult<SymbolicValue<Atom>>,
    })
    return plan
  }

  private resolve(plan: Plan<Atom>, options: SymbolicValueResolveOptions, scalar: boolean): EvaluatedValueResult<unknown> {
    const state: State = { limits: options.limits ? resolveBoundedValueLimits({ ...this.#limits, ...options.limits }) : this.#limits,
      signal: options.signal, dependencies: new Set(), evidence: new Set(), active: new Map(), steps: 0 }
    state.signal?.throwIfAborted()
    const value = this.evaluatePlan(plan, state)
    const result = { ...this.result(state.exhausted ?? value, state, scalar), limits: state.limits }
    Object.defineProperty(result, PROOF, { value: {
      model: this.#model,
      limits: JSON.stringify(state.limits),
      dependencies: new Map([...state.dependencies].map((key) => [key, this.#index.fingerprints.get(key)])),
    } satisfies ProofMetadata })
    return Object.freeze(result)
  }

  private evaluatePlan(plan: Plan<Atom>, state: State): RuntimeValue<Atom> {
    if (plan.kind === 'value') return this.visit(plan.occurrence, new Map(), state, 0)
    const input = this.evaluatePlan(plan.input, state)
    if (plan.kind === 'property') return this.property(input, plan.name, state, 0)
    return this.invoke(input, state, 0)
  }

  private visit(id: OccurrenceId, environment: Environment<Atom>, state: State, depth: number): RuntimeValue<Atom> {
    state.signal?.throwIfAborted()
    if (++state.steps > state.limits.maximumSteps) return exhaust(state, 'VALUE_STEP_LIMIT', 'Bounded value evaluation exceeded its step limit.')
    if (depth > state.limits.maximumDepth) return exhaust(state, 'VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.')
    const frames = state.active.get(id) ?? new Set<object>()
    if (frames.has(environment)) return uncertain('VALUE_RECURSION', 'Value propagation encountered a recursive occurrence.')
    this.depend(state, `occurrence:${id}`)
    const occurrence = this.#index.occurrences.get(id)
    if (!occurrence) return uncertain('VALUE_OCCURRENCE_MISSING', `Occurrence ${id} is unavailable.`)
    frames.add(environment)
    state.active.set(id, frames)
    try { return this.expression(occurrence, environment, state, depth) }
    finally { frames.delete(environment); if (!frames.size) state.active.delete(id) }
  }

  private expression(occurrence: BodyOccurrence, environment: Environment<Atom>, state: State, depth: number): RuntimeValue<Atom> {
    const id = occurrence.id
    const children = this.#index.children.get(id)
    const next = (child: OccurrenceId | undefined, env = environment): RuntimeValue<Atom> => child
      ? this.visit(child, env, state, depth + 1)
      : uncertain('VALUE_RELATION_MISSING', 'A required value relation is unavailable.')
    const call = this.#index.calls.get(id)
    if (call) return this.call(call, environment, state, depth)
    if (FUNCTION_SYNTAX.has(occurrence.syntax)) {
      if (occurrence.symbol) this.depend(state, `function:${occurrence.symbol}`)
      const body = occurrence.symbol && this.#index.bodies.get(occurrence.symbol)
      return body ? { kind: 'function', body, environment } : uncertain('VALUE_BODY_MISSING', 'The function body is unavailable.')
    }
    if (occurrence.syntax === 'ObjectLiteralExpression') {
      const properties = new Map<string, Reference<Atom>>()
      let incomplete = false
      const entries = [...(children ?? [])].filter(([role]) => role.startsWith('property:'))
        .sort(([left], [right]) => Number(left.slice(9)) - Number(right.slice(9)))
      for (const [, property] of entries) {
        const node = this.#index.occurrences.get(property)!
        const links = this.#index.children.get(property)
        if (node.syntax === 'SpreadAssignment') {
          const spread = next(links?.get('expression'))
          if (spread.kind === 'object') {
            if (spread.incomplete) { properties.clear(); incomplete = true }
            for (const [name, value] of spread.properties) properties.set(name, value)
          } else { properties.clear(); incomplete = true }
          continue
        }
        const nameId = links?.get('name') ?? (node.syntax === 'ShorthandPropertyAssignment' ? links?.get('child:0') : undefined)
        const nameNode = nameId && this.#index.occurrences.get(nameId)
        const nameSymbol = nameNode?.symbol ?? (node.syntax === 'MethodDeclaration' ? node.symbol : undefined)
        if (nameSymbol) this.depend(state, `symbol:${nameSymbol}`)
        const directName = nameId && this.#index.direct.get(nameId)
        const name = (nameSymbol && this.#index.symbols.get(nameSymbol)?.payload.name) ||
          (directName?.kind === 'known' && typeof directName.value === 'string' ? directName.value : undefined)
        if (!name) { properties.clear(); incomplete = true; continue }
        const value = node.syntax === 'MethodDeclaration' ? property : links?.get('initializer') ??
          (node.syntax === 'ShorthandPropertyAssignment' ? nameId : undefined)
        if (value) properties.set(name, { occurrence: value, environment })
        else { properties.delete(name); incomplete = true }
      }
      return { kind: 'object', properties, incomplete }
    }
    if (occurrence.syntax === 'ConditionalExpression') {
      const condition = children?.get('condition')
      if (condition) this.depend(state, `occurrence:${condition}`)
      const value = condition && this.#index.direct.get(condition)
      if (value?.kind === 'known' && typeof value.value === 'boolean') return next(children?.get(value.value ? 'when-true' : 'when-false'))
      return alternatives([next(children?.get('when-true')), next(children?.get('when-false'))], state)
    }
    if (TRANSPARENT_SYNTAX.has(occurrence.syntax)) return next(children?.get('expression'))
    if (occurrence.syntax === 'ReturnStatement') return children?.has('expression') ? next(children.get('expression')) : UNDEFINED
    if (occurrence.syntax === 'VariableDeclaration' || occurrence.syntax === 'PropertyAssignment') return next(children?.get('initializer'))
    if (occurrence.syntax === 'Identifier' || occurrence.syntax === 'Parameter') {
      const bound = occurrence.symbol && environment.get(occurrence.symbol)
      if (bound) return next(bound.occurrence, bound.environment)
      const definitions = this.#index.definitions.get(id)
      if (definitions?.length) return alternatives(definitions.map((definition) => next(definition)), state)
      for (const parent of this.#index.parents.get(id) ?? []) {
        const node = this.#index.occurrences.get(parent.parent)
        if (parent.role === 'name' && (node?.syntax === 'VariableDeclaration' || node?.syntax === 'PropertyAssignment')) return next(this.#index.children.get(parent.parent)?.get('initializer'))
        if (parent.role === 'left' && node?.kind === 'assignment') {
          return uncertain('VALUE_ASSIGNMENT_UNSUPPORTED', 'Assignment operands do not prove the effective assigned value.')
        }
      }
      if (occurrence.symbol) {
        this.depend(state, `initializers:${occurrence.symbol}`, `function:${occurrence.symbol}`, `symbol:${occurrence.symbol}`)
        const initializers = this.#index.initializers.get(occurrence.symbol)
        if (initializers?.length) return alternatives(initializers.map((initializer) => next(initializer)), state)
        const body = this.#index.bodies.get(occurrence.symbol)
        if (body) return { kind: 'function', body, environment }
        if (occurrence.symbolOrigin) return { kind: 'external', symbol: occurrence.symbol, symbolOrigin: occurrence.symbolOrigin }
      }
    }
    if (occurrence.syntax === 'PropertyAccessExpression') {
      const receiver = next(children?.get('receiver') ?? children?.get('child:0'))
      const nameId = children?.get('name') ?? children?.get('child:1')
      const symbol = nameId && this.#index.occurrences.get(nameId)?.symbol
      if (symbol) this.depend(state, `symbol:${symbol}`)
      const name = symbol && this.#index.symbols.get(symbol)?.payload.name
      return name ? this.property(receiver, name, state, depth + 1) : uncertain('VALUE_PROPERTY_UNRESOLVED', 'The property identity is unavailable.')
    }
    const direct = this.#index.direct.get(id)
    if (direct?.kind === 'known') return { kind: 'literal', value: direct.value }
    if (direct?.kind === 'ambiguous') return alternatives<Atom>(direct.values.map((value) => ({ kind: 'literal' as const, value })), state)
    if (direct?.kind === 'unsupported') return { kind: 'unsupported', construct: direct.construct }
    if (occurrence.syntax === 'TrueKeyword') return { kind: 'literal', value: true }
    if (occurrence.syntax === 'FalseKeyword') return { kind: 'literal', value: false }
    if (occurrence.syntax === 'NullKeyword') return { kind: 'literal', value: null }
    if (occurrence.syntax === 'ArrayLiteralExpression') return { kind: 'object', properties: new Map(), incomplete: true }
    return uncertain('VALUE_NO_SEMANTIC_PATH', `No bounded value path is available for ${occurrence.syntax}.`)
  }

  private call(call: ResolvedCall, environment: Environment<Atom>, state: State, depth: number): RuntimeValue<Atom> {
    const callee = this.#index.children.get(call.occurrence)?.get('callee')
    const operand = (id: OccurrenceId) => this.result(this.visit(id, environment, state, depth + 1), state, false) as ValueResult<SymbolicValue<Atom>>
    const modeled = this.#model?.({
      call,
      callee: () => callee ? operand(callee) : this.result(uncertain('VALUE_CALLEE_MISSING', 'The call has no callee occurrence.'), state, false) as ValueResult<SymbolicValue<Atom>>,
      receiver: () => call.receiver ? operand(call.receiver) : undefined,
      argument: (index) => call.arguments[index] ? operand(call.arguments[index]!) : undefined,
    })
    if (modeled) return modeled.kind === 'atom' ? modeled : uncertain('VALUE_MODEL_UNKNOWN', modeled.reason)
    if (call.bindings.some((binding) => binding.rest) || call.arguments.some((id) => this.#index.occurrences.get(id)?.syntax === 'SpreadElement')) {
      return uncertain('VALUE_ARGUMENT_BINDING_UNSUPPORTED', 'Spread and rest arguments require an aggregate argument binding.')
    }
    if (call.target) this.depend(state, `function:${call.target}`)
    const body = call.target && this.#index.bodies.get(call.target)
    // Resolve the callee first to preserve environments of returned/stored closures.
    const resolved = callee ? this.visit(callee, environment, state, depth + 1) : undefined
    const target = resolved?.kind === 'function' || resolved?.kind === 'alternatives'
      ? resolved
      : body ? { kind: 'function' as const, body, environment }
        : call.target ? { kind: 'unsupported' as const, construct: 'external-or-bodyless-call' }
          : resolved?.kind === 'unknown' ? resolved : uncertain('VALUE_DYNAMIC_CALL', 'The call target is unresolved or dynamic.')
    return this.invoke(target, state, depth + 1, call, environment)
  }

  private invoke(value: RuntimeValue<Atom>, state: State, depth: number, call?: ResolvedCall, caller: Environment<Atom> = new Map()): RuntimeValue<Atom> {
    state.signal?.throwIfAborted()
    if (depth > state.limits.maximumDepth) return exhaust(state, 'VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.')
    if (value.kind === 'unknown' || value.kind === 'unsupported') return value
    if (value.kind === 'alternatives') return alternatives(value.values.map((item) => this.invoke(item, state, depth + 1, call, caller)), state)
    if (value.kind !== 'function') return uncertain('VALUE_NOT_CALLABLE', 'The resolved value is not an inspectable function.')
    const body = value.body.payload.body
    this.depend(state, `function:${body.function}`)
    if (body.execution !== 'sync') return uncertain('VALUE_EXECUTION_UNSUPPORTED', 'The function is not proved to produce a synchronous value.')
    if (body.summary.recursion) return uncertain('VALUE_RECURSION', 'The target function is recursive.')
    const completeness = value.body.completeness
    if (completeness.kind !== 'complete' && (completeness.kind !== 'partial' || completeness.reasons.some(({ code }) => code !== 'CFG_EXPRESSION_BRANCH_PARTIAL'))) {
      return uncertain('VALUE_CONTROL_FLOW_INCOMPLETE', 'The function control flow is incomplete in this snapshot.')
    }
    const environment = new Map(value.environment)
    for (const binding of call?.bindings ?? []) {
      if (binding.parameter) environment.set(binding.parameter, { occurrence: binding.argument, environment: caller })
    }
    if (!body.summary.returns.length) return UNDEFINED
    const returned = body.summary.returns.map((id) => this.visit(id, environment, state, depth + 1))
    if (body.occurrences.some(({ syntax }) => syntax === 'Block') && body.edges.some(({ to, kind }) => to === 'exit' && kind === 'fallthrough')) returned.push(UNDEFINED)
    return alternatives(returned, state)
  }

  private property(value: RuntimeValue<Atom>, name: string, state: State, depth: number): RuntimeValue<Atom> {
    state.signal?.throwIfAborted()
    if (value.kind === 'unknown' || value.kind === 'unsupported') return value
    if (value.kind === 'alternatives') return alternatives(value.values.map((item) => this.property(item, name, state, depth + 1)), state)
    if (value.kind !== 'object') return uncertain('VALUE_PROPERTY_UNSUPPORTED', 'The receiver has no inspectable object properties.')
    const property = value.properties.get(name)
    return property ? this.visit(property.occurrence, property.environment, state, depth + 1)
      : value.incomplete ? uncertain('VALUE_PROPERTY_INCOMPLETE', `The effective ${name} property is unknown.`) : UNDEFINED
  }

  private result(value: RuntimeValue<Atom>, state: State, scalar: boolean): ValueResult<unknown> {
    const evidence = [...state.evidence].sort()
    if (value.kind === 'unknown') return { kind: 'unknown', reasons: [{ code: value.code, message: value.reason, retryable: false }], evidence }
    if (value.kind === 'unsupported') return { kind: 'unsupported', construct: value.construct, evidence }
    if (value.kind === 'alternatives') {
      const results = value.values.map((item) => this.result(item, state, scalar))
      const incomplete = results.find((item) => item.kind === 'unknown' || item.kind === 'unsupported')
      if (incomplete) return { ...incomplete, evidence }
      const values = [...new Map(results.flatMap((item) => item.kind === 'known' ? [item.value] : item.kind === 'ambiguous' ? item.values : [])
        .map((item) => [JSON.stringify(item), item])).values()]
      if (values.length === 1) return { kind: 'known', value: values[0], evidence }
      return { kind: 'ambiguous', values, reasons: [{ code: 'VALUE_ALTERNATIVES', message: 'Several statically reachable values remain possible.', effective: { alternatives: values.length } }], evidence }
    }
    if (scalar) return value.kind === 'literal' ? { kind: 'known', value: value.value, evidence }
      : { kind: 'unknown', reasons: [{ code: 'VALUE_NOT_LITERAL', message: 'The value is symbolic rather than a materialized literal.', retryable: false }], evidence }
    const projected: SymbolicValue<Atom> = value.kind === 'function'
      ? { kind: 'function', symbol: value.body.payload.body.function, execution: value.body.payload.body.execution, parameterCount: value.body.payload.body.parameters.length }
      : value.kind === 'object' ? { kind: 'object', properties: [...value.properties.keys()].sort(), complete: !value.incomplete } : value
    return { kind: 'known', value: projected, evidence }
  }

  private depend(state: State, ...keys: readonly string[]): void {
    for (const key of keys) {
      state.dependencies.add(key)
      for (const fact of this.#index.evidence.get(key) ?? []) state.evidence.add(fact)
    }
  }
}

const FUNCTION_SYNTAX = new Set(['ArrowFunction', 'FunctionExpression', 'FunctionDeclaration', 'MethodDeclaration'])
const TRANSPARENT_SYNTAX = new Set(['ParenthesizedExpression', 'NonNullExpression', 'SatisfiesExpression', 'AsExpression', 'TypeAssertionExpression'])

function uncertain(code: string, reason: string): RuntimeValue<never> { return { kind: 'unknown', code, reason } }

function exhaust(state: State, code: string, reason: string): RuntimeValue<never> {
  state.exhausted ??= { kind: 'unknown', code, reason }
  return state.exhausted
}

function alternatives<Atom>(values: readonly RuntimeValue<Atom>[], state: State): RuntimeValue<Atom> {
  const flattened = values.flatMap((value) => value.kind === 'alternatives' ? value.values : [value])
  if (flattened.length > state.limits.maximumAlternatives) return exhaust(state, 'VALUE_ALTERNATIVE_LIMIT', 'Bounded value evaluation exceeded its alternative limit.')
  if (!flattened.length) return UNDEFINED
  return flattened.length === 1 ? flattened[0]! : { kind: 'alternatives', values: flattened }
}

async function indexFacts(query: AnalysisQuery): Promise<Index> {
  const reader = createTypeScriptFactReader(query)
  const [bodyFacts, symbolFacts] = await Promise.all([collect(reader.export('body')), collect(reader.export('symbol'))])
  const bodies = new Map<SymbolId, Body>()
  const occurrences = new Map<OccurrenceId, BodyOccurrence>()
  const children = new Map<OccurrenceId, Map<string, OccurrenceId>>()
  const parents = new Map<OccurrenceId, { parent: OccurrenceId; role: string }[]>()
  const definitions = new Map<OccurrenceId, OccurrenceId[]>()
  const initializers = new Map<SymbolId, OccurrenceId[]>()
  const calls = new Map<OccurrenceId, ResolvedCall>()
  const direct = new Map<OccurrenceId, ValueResult<unknown>>()
  const fingerprints = new Map<string, string>()
  const evidence = new Map<string, readonly FactId[]>()
  const bind = (key: string, fact: TypeScriptFact<'body'> | TypeScriptFact<'symbol'>, fingerprint: string) => {
    fingerprints.set(key, fingerprint)
    evidence.set(key, [fact.id])
  }
  for (const fact of bodyFacts) {
    const body = fact.payload.body
    const fingerprint = hashFact(fact)
    bodies.set(body.function, fact)
    bind(`function:${body.function}`, fact, fingerprint)
    for (const occurrence of body.occurrences) {
      const previous = occurrences.get(occurrence.id)
      if (previous && previous.owner !== occurrence.owner) throw new Error(`Occurrence ${occurrence.id} has multiple function owners.`)
      occurrences.set(occurrence.id, occurrence)
      bind(`occurrence:${occurrence.id}`, fact, fingerprint)
    }
    for (const relation of body.relations) {
      let map = children.get(relation.parent)
      if (!map) children.set(relation.parent, (map = new Map()))
      map.set(relation.role, relation.child)
      append(parents, relation.child, { parent: relation.parent, role: relation.role })
    }
    for (const definition of body.definitions) append(definitions, definition.use, definition.definition)
    for (const call of body.calls) calls.set(call.occurrence, call)
    for (const [id, value] of Object.entries(fact.payload.values)) direct.set(id as OccurrenceId, value)
  }
  for (const occurrence of occurrences.values()) {
    if (occurrence.syntax !== 'VariableDeclaration') continue
    const links = children.get(occurrence.id)
    const name = links?.get('name')
    const initializer = links?.get('initializer')
    const symbol = name && occurrences.get(name)?.symbol
    if (symbol && initializer) append(initializers, symbol, initializer)
  }
  for (const [symbol, values] of initializers) {
    fingerprints.set(`initializers:${symbol}`, JSON.stringify([...values].sort()))
    evidence.set(`initializers:${symbol}`, [...new Set(values.flatMap((id) => evidence.get(`occurrence:${id}`) ?? []))])
  }
  for (const fact of symbolFacts) bind(`symbol:${fact.payload.symbol}`, fact, hashFact(fact))
  return { bodies, occurrences, children, parents, definitions, initializers, calls, direct,
    symbols: new Map(symbolFacts.map((fact) => [fact.payload.symbol, fact])), fingerprints, evidence }
}

function hashFact(fact: Body | TypeScriptFact<'symbol'>): string {
  return createHash('sha256').update(JSON.stringify({ id: fact.id, payload: fact.payload, completeness: fact.completeness })).digest('hex')
}

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

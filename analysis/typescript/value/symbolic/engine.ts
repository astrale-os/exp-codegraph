import { createHash } from 'node:crypto'
import type { FactId, OccurrenceId, SymbolId } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import type { BodyOccurrence, ResolvedCall, TypeScriptCallInventory, TypeScriptCallQuery } from '../../body/index.ts'
import { createTypeScriptFactReader, type TypeScriptFact } from '../../facts/index.ts'
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions, BoundedValueLimits, EvaluatedValueResult, ValueResult } from '../model.ts'
import { resolveBoundedValueLimits } from '../limits.ts'
import type { SymbolicCallModel, SymbolicOperandPlan, SymbolicValue, SymbolicValuePlan, SymbolicValueResolveOptions } from './model.ts'
import { createCallProjection } from './calls.ts'
import { resolutionResultBytes, type ValueResolutionCache } from './cache.ts'

type Environment<Atom> = ReadonlyMap<SymbolId, Reference<Atom>>
interface Reference<Atom> { readonly occurrence: OccurrenceId; readonly environment: Environment<Atom> }
type Body = TypeScriptFact<'body'>
type RuntimeValue<Atom> =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'atom'; readonly value: Atom }
  | { readonly kind: 'external'; readonly symbol: SymbolId; readonly symbolOrigin?: BodyOccurrence['symbolOrigin']; readonly moduleNamespace?: boolean }
  | { readonly kind: 'function'; readonly body: Body; readonly environment: Environment<Atom> }
  | { readonly kind: 'object'; readonly properties: ReadonlyMap<string, Reference<Atom>>; readonly incomplete: boolean }
  | { readonly kind: 'alternatives'; readonly values: readonly RuntimeValue<Atom>[] }
  | { readonly kind: 'unknown'; readonly code: string; readonly reason: string; readonly candidates?: readonly RuntimeValue<Atom>[] }
  | { readonly kind: 'unsupported'; readonly construct: string }

interface Index {
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
  readonly mutations: ReadonlyMap<SymbolId, readonly SymbolId[]>
  readonly escapes: ReadonlySet<SymbolId>
  readonly aliases: ReadonlyMap<SymbolId, readonly SymbolId[]>
  readonly fingerprints: ReadonlyMap<string, string>
  readonly evidence: ReadonlyMap<string, readonly FactId[]>
}

interface State {
  readonly limits: Readonly<Required<BoundedValueLimits>>
  readonly signal?: AbortSignal
  readonly dependencies: Set<string>
  readonly evidence: Set<FactId>
  readonly active: Map<OccurrenceId, Set<object>>
  readonly effects: Map<string, 'none' | 'local' | 'other'>
  steps: number
  exhausted?: Extract<RuntimeValue<never>, { kind: 'unknown' }>
}

type Plan<Atom> =
  | { readonly kind: 'value'; readonly occurrence: OccurrenceId }
  | { readonly kind: 'unavailable'; readonly code: string; readonly reason: string }
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
interface ValueEvaluatorFactory {
  <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>): Promise<BoundedValueEvaluator<Atom>>
  calls(options?: TypeScriptCallQuery): Promise<TypeScriptCallInventory>
}

export function createValueEvaluatorFactory(query: AnalysisQuery, cache?: ValueResolutionCache): ValueEvaluatorFactory {
  let pending: Promise<Index> | undefined
  const index = () => {
    pending ??= indexFacts(query).catch((error) => { pending = undefined; throw error })
    return pending
  }
  return Object.assign(async <Atom = never>(options: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'> = {}) =>
    new Evaluator(await index(), options.call, resolveBoundedValueLimits(options.limits), cache),
  { calls: createCallProjection(query, index) })
}

class Evaluator<Atom> implements BoundedValueEvaluator<Atom> {
  readonly #index: Index
  readonly #model: SymbolicCallModel<Atom> | undefined
  readonly #limits: Readonly<Required<BoundedValueLimits>>
  readonly #cache: ValueResolutionCache | undefined
  readonly #operands = new WeakMap<SymbolicOperandPlan<Atom>, { readonly state: State; readonly read: () => RuntimeValue<Atom> }>()

  constructor(index: Index, model: SymbolicCallModel<Atom> | undefined, limits: Readonly<Required<BoundedValueLimits>>, cache?: ValueResolutionCache) {
    this.#index = index
    this.#model = model
    this.#limits = limits
    this.#cache = cache
  }

  value(occurrence: OccurrenceId): SymbolicValuePlan<Atom> { return this.plan({ kind: 'value', occurrence }) }

  canReuse(proof: EvaluatedValueResult<unknown>): boolean {
    return this.reusable(proof, this.#limits)
  }

  private reusable(proof: EvaluatedValueResult<unknown>, limits: Readonly<Required<BoundedValueLimits>>): boolean {
    const metadata = (proof as Proof)[PROOF]
    return !!metadata && metadata.model === this.#model && metadata.limits === JSON.stringify(limits) &&
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
    const limits = options.limits ? resolveBoundedValueLimits({ ...this.#limits, ...options.limits }) : this.#limits
    options.signal?.throwIfAborted()
    const key = this.#cache && JSON.stringify([this.#cache.model(this.#model), scalar, limits, plan])
    const cached = key && this.#cache?.get(key, (proof) => this.reusable(proof, limits))
    if (cached) return cached
    const state: State = { limits,
      signal: options.signal, dependencies: new Set(), evidence: new Set(), active: new Map(), effects: new Map(), steps: 0 }
    state.signal?.throwIfAborted()
    const value = this.evaluatePlan(plan, state)
    const evaluated = this.result(value, state, scalar)
    const bounded = state.exhausted ? {
      ...this.result(state.exhausted, state, scalar),
      ...(evaluated.kind === 'unknown' ? {
        reasons: [...new Map([...evaluated.reasons, { code: state.exhausted.code, message: state.exhausted.reason, retryable: false }]
          .map((reason) => [`${reason.code}\0${reason.message}`, reason])).values()],
        ...(evaluated.candidates ? { candidates: evaluated.candidates } : {}),
      } : {}),
    } as ValueResult<unknown> : evaluated
    const result = { ...freezeResult(bounded, scalar), limits: state.limits }
    const metadata: ProofMetadata = {
      model: this.#model,
      limits: JSON.stringify(state.limits),
      dependencies: new Map([...state.dependencies].map((key) => [key, this.#index.fingerprints.get(key)])),
    }
    const resultBytes = key ? resolutionResultBytes(result) : undefined
    Object.defineProperty(result, PROOF, { value: metadata })
    const frozen = Object.freeze(result)
    state.signal?.throwIfAborted()
    if (key && resultBytes !== undefined) {
      const dependencyBytes = [...metadata.dependencies].reduce((bytes, [name, fingerprint]) => bytes + 96 + name.length * 2 + (fingerprint?.length ?? 0) * 2, 0)
      this.#cache!.put(key, frozen, resultBytes + dependencyBytes)
    }
    return frozen
  }

  private evaluatePlan(plan: Plan<Atom>, state: State, environment: Environment<Atom> = new Map(), depth = 0): RuntimeValue<Atom> {
    if (state.exhausted) return state.exhausted
    if (depth > state.limits.maximumDepth) return exhaust(state, 'VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.')
    if (plan.kind === 'unavailable') return uncertain(plan.code, plan.reason)
    if (plan.kind === 'value') return this.visit(plan.occurrence, environment, state, depth)
    const input = this.evaluatePlan(plan.input, state, environment, depth + 1)
    if (plan.kind === 'property') return this.property(input, plan.name, state, depth)
    return this.invoke(input, state, depth)
  }

  private operandPlan(node: Plan<Atom>, environment: Environment<Atom>, state: State, depth: number, active: () => boolean): SymbolicOperandPlan<Atom> {
    const read = () => {
      if (!active()) throw new Error('A symbolic operand can only be resolved during its call model.')
      const value = this.evaluatePlan(node, state, environment, depth)
      return state.exhausted ?? value
    }
    const plan = Object.freeze({
      property: (name: string) => this.operandPlan({ kind: 'property', input: node, name }, environment, state, depth, active),
      invoke: () => this.operandPlan({ kind: 'invoke', input: node }, environment, state, depth, active),
      resolve: () => this.result(read(), state, false) as ValueResult<SymbolicValue<Atom>>,
    })
    this.#operands.set(plan, { state, read })
    return plan
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
    try {
      const value = this.expression(occurrence, environment, state, depth)
      if (occurrence.symbol) {
        if (this.effect('escape', occurrence.symbol, state) !== 'none') return escaped(value, state)
      }
      return value
    }
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
        const name = node.propertyName || (nameSymbol && this.#index.symbols.get(nameSymbol)?.payload.name) ||
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
      const assigned = this.assignmentValue(id)
      if (assigned) return next(assigned)
      const definitions = this.#index.definitions.get(id)
      if (occurrence.symbol) {
        const localAssignment = definitions?.length === 1 && this.#index.definiteDefinitions.has(id) && this.assignmentValue(definitions[0]!)
        const effect = this.effect('mutation', occurrence.symbol, state, localAssignment ? occurrence.owner : undefined)
        if (effect !== 'none') {
          if (localAssignment && effect === 'local') return next(localAssignment)
          this.depend(state, `initializers:${occurrence.symbol}`)
          const observed = (this.#index.initializers.get(occurrence.symbol) ?? []).map((initializer) => next(initializer))
          const bound = environment.get(occurrence.symbol)
          if (bound) observed.push(next(bound.occurrence, bound.environment))
          return { kind: 'unknown', code: 'VALUE_MUTATION_UNSUPPORTED',
            reason: 'Writes to this binding or an object alias prevent an initializer-only value proof.', candidates: observed }
        }
      }
      const bound = occurrence.symbol && environment.get(occurrence.symbol)
      if (bound) return next(bound.occurrence, bound.environment)
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
        if (occurrence.symbolOrigin || occurrence.symbolKind === 'module-namespace') return { kind: 'external', symbol: occurrence.symbol, symbolOrigin: occurrence.symbolOrigin, moduleNamespace: occurrence.symbolKind === 'module-namespace' }
      }
    }
    if (occurrence.syntax === 'PropertyAccessExpression') {
      const receiver = next(children?.get('receiver') ?? children?.get('child:0'))
      const nameId = children?.get('name') ?? children?.get('child:1')
      const member = nameId && this.#index.occurrences.get(nameId)
      const symbol = member?.symbol
      if (nameId) this.depend(state, `occurrence:${nameId}`)
      if (symbol) this.depend(state, `symbol:${symbol}`)
      if (receiver.kind === 'external' && receiver.moduleNamespace && receiver.symbol === occurrence.propertyNamespace && member?.symbol) {
        return next(nameId || undefined)
      }
      const name = occurrence.propertyName
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
    let active = true
    const operand = (id: OccurrenceId) => this.operandPlan({ kind: 'value', occurrence: id }, environment, state, depth + 1, () => active)
    let modeled: RuntimeValue<Atom> | undefined
    try {
      const output = this.#model?.({
        call,
        callee: () => callee ? operand(callee) : this.operandPlan({ kind: 'unavailable', code: 'VALUE_CALLEE_MISSING', reason: 'The call has no callee occurrence.' }, environment, state, depth + 1, () => active),
        receiver: () => call.receiver ? operand(call.receiver) : undefined,
        argument: (index) => call.arguments[index] ? operand(call.arguments[index]!) : undefined,
      })
      if (output) {
        if ('kind' in output) modeled = output.kind === 'atom' ? output : uncertain('VALUE_MODEL_UNKNOWN', output.reason)
        else {
          const transfer = this.#operands.get(output)
          if (!transfer || transfer.state !== state) throw new Error('A call model can only return an operand from its active proof.')
          modeled = transfer.read()
        }
      }
    } finally { active = false }
    if (state.exhausted) return state.exhausted
    if (modeled) return modeled
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

  private assignmentValue(id: OccurrenceId): OccurrenceId | undefined {
    for (const parent of this.#index.parents.get(id) ?? []) {
      if (parent.role === 'left' && this.#index.occurrences.get(parent.parent)?.operator === 'EqualsToken') return this.#index.children.get(parent.parent)?.get('right')
    }
    return
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
    if (value.kind === 'unknown') {
      const candidates = (value.candidates ?? []).flatMap((candidate) => {
        const result = this.result(candidate, state, scalar)
        return result.kind === 'known' ? [result.value] : result.kind === 'ambiguous' ? result.values : result.kind === 'unknown' ? result.candidates ?? [] : []
      })
      return { kind: 'unknown', reasons: [{ code: value.code, message: value.reason, retryable: false }], ...(candidates.length ? { candidates } : {}), evidence }
    }
    if (value.kind === 'unsupported') return { kind: 'unsupported', construct: value.construct, evidence }
    if (value.kind === 'alternatives') {
      const results = value.values.map((item) => this.result(item, state, scalar))
      const incomplete = results.filter((item) => item.kind === 'unknown' || item.kind === 'unsupported')
      if (incomplete.length) {
        const candidates = distinctValues(results.flatMap((item) => item.kind === 'known' ? [item.value]
          : item.kind === 'ambiguous' ? item.values : item.kind === 'unknown' ? item.candidates ?? [] : []), scalar)
        return { kind: 'unknown', reasons: incomplete.flatMap((item) => item.kind === 'unknown' ? item.reasons
          : [{ code: 'VALUE_PATH_UNSUPPORTED', message: `A possible value path uses ${item.construct}.`, retryable: false }]),
          ...(candidates.length ? { candidates } : {}), evidence }
      }
      const values = distinctValues(results.flatMap((item) => item.kind === 'known' ? [item.value] : item.kind === 'ambiguous' ? item.values : []), scalar)
      if (values.length === 1) return { kind: 'known', value: values[0], evidence }
      return { kind: 'ambiguous', values, reasons: [{ code: 'VALUE_ALTERNATIVES', message: 'Several statically reachable values remain possible.', effective: { alternatives: values.length } }], evidence }
    }
    if (scalar) return value.kind === 'literal' ? { kind: 'known', value: value.value, evidence }
      : { kind: 'unknown', reasons: [{ code: 'VALUE_NOT_LITERAL', message: 'The value is symbolic rather than a materialized literal.', retryable: false }], evidence }
    const projected: SymbolicValue<Atom> = value.kind === 'function'
      ? { kind: 'function', symbol: value.body.payload.body.function, execution: value.body.payload.body.execution, parameterCount: value.body.payload.body.parameters.length }
      : value.kind === 'object' ? { kind: 'object', properties: [...value.properties.keys()].sort(), complete: !value.incomplete }
        : value.kind === 'external' ? { kind: 'external', symbol: value.symbol, ...(value.symbolOrigin ? { symbolOrigin: value.symbolOrigin } : {}) } : value
    return { kind: 'known', value: projected, evidence }
  }

  private effect(kind: 'mutation' | 'escape', symbol: SymbolId, state: State, localOwner?: SymbolId): 'none' | 'local' | 'other' {
    const cacheKey = `${kind}:${symbol}:${localOwner ?? ''}`
    const cached = state.effects.get(cacheKey)
    if (cached) return cached
    const pending = [symbol]
    const seen = new Set<SymbolId>()
    let result: 'none' | 'local' | 'other' = 'none'
    while (pending.length) {
      state.signal?.throwIfAborted()
      const current = pending.pop()!
      if (seen.has(current)) continue
      seen.add(current)
      this.depend(state, `${kind}:${current}`, `aliases:${current}`)
      const owners = kind === 'mutation' ? this.#index.mutations.get(current) : undefined
      if (kind === 'escape' ? this.#index.escapes.has(current) : owners?.length) {
        if (current !== symbol || !localOwner || owners?.some((owner) => owner !== localOwner)) { result = 'other'; break }
        result = 'local'
      }
      for (const alias of this.#index.aliases.get(current) ?? []) {
        if (++state.steps > state.limits.maximumSteps) {
          exhaust(state, 'VALUE_STEP_LIMIT', 'Bounded value evaluation exceeded its step limit.')
          return 'other'
        }
        pending.push(alias)
      }
    }
    state.effects.set(cacheKey, result)
    return result
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
  const definiteDefinitions = new Set<OccurrenceId>()
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
    for (const definition of body.definitions) {
      append(definitions, definition.use, definition.definition)
      if (definition.reaching === 'definite') definiteDefinitions.add(definition.use)
    }
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
  // Initializer provenance cannot prove an object's later shape after an observed
  // write. Follow direct aliases conservatively; do not invent heap execution.
  const mutations = new Map<SymbolId, Set<string>>()
  const escapes = new Map<SymbolId, Set<string>>()
  const aliases = new Map<SymbolId, Map<SymbolId, Set<string>>>()
  const alias = (from: SymbolId, to: SymbolId, evidence: string) => {
    let targets = aliases.get(from)
    if (!targets) aliases.set(from, (targets = new Map()))
    let links = targets.get(to)
    if (!links) targets.set(to, (links = new Set()))
    links.add(evidence)
  }
  const rootSymbol = (id: OccurrenceId | undefined): SymbolId | undefined => {
    const seen = new Set<OccurrenceId>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const node = occurrences.get(id)
      if (!node) return
      if (node.syntax === 'Identifier') return node.symbol
      const links = children.get(id)
      if (node.syntax === 'PropertyAccessExpression' || node.syntax === 'ElementAccessExpression') id = links?.get('receiver') ?? links?.get('child:0')
      else if (TRANSPARENT_SYNTAX.has(node.syntax)) id = links?.get('expression')
      else return
    }
    return
  }
  for (const [symbol, values] of initializers) {
    for (const value of values) {
      const target = rootSymbol(value)
      if (target && target !== symbol) alias(symbol, target, `occurrence:${value}`)
    }
  }
  for (const call of calls.values()) {
    for (const binding of call.bindings) {
      const argument = rootSymbol(binding.argument)
      if (binding.parameter && argument && binding.parameter !== argument) alias(binding.parameter, argument, `occurrence:${call.occurrence}`)
    }
    if (call.target && bodies.has(call.target) && !call.dynamic) continue
    for (const argument of call.arguments) {
      const symbol = rootSymbol(argument)
      if (!symbol) continue
      let inputs = escapes.get(symbol)
      if (!inputs) escapes.set(symbol, (inputs = new Set()))
      inputs.add(`occurrence:${call.occurrence}`)
    }
  }
  for (const occurrence of occurrences.values()) {
    const links = children.get(occurrence.id)
    const target = occurrence.kind === 'assignment' ? links?.get('left')
      : occurrence.syntax === 'DeleteExpression' ? links?.get('expression') : undefined
    const symbol = rootSymbol(target)
    if (symbol) {
      let writes = mutations.get(symbol)
      if (!writes) mutations.set(symbol, (writes = new Set()))
      writes.add(`occurrence:${occurrence.id}`)
    }
  }
  // Store direct effects and reverse alias edges only. Expanding the transitive
  // proof sets here is quadratic on real projects; each demanded traversal is
  // instead bounded by its caller's value budget and records negative lookups.
  const incoming = new Map<SymbolId, SymbolId[]>()
  const aliasEvidence = new Map<SymbolId, Set<string>>()
  for (const [from, targets] of aliases) for (const [to, links] of targets) {
    append(incoming, to, from)
    let keys = aliasEvidence.get(to)
    if (!keys) aliasEvidence.set(to, (keys = new Set()))
    for (const link of links) keys.add(link)
  }
  for (const [kind, entries] of [['mutation', mutations], ['escape', escapes], ['aliases', aliasEvidence]] as const) {
    for (const [symbol, writes] of entries) {
      const keys = [...writes].sort()
      fingerprints.set(`${kind}:${symbol}`, JSON.stringify(keys.map((key) => [key, fingerprints.get(key)])))
      evidence.set(`${kind}:${symbol}`, [...new Set(keys.flatMap((key) => evidence.get(key) ?? []))])
    }
  }
  for (const fact of symbolFacts) bind(`symbol:${fact.payload.symbol}`, fact, hashFact(fact))
  return { bodies, occurrences, children, parents, definitions, definiteDefinitions, initializers, calls, direct,
    symbols: new Map(symbolFacts.map((fact) => [fact.payload.symbol, fact])),
    mutations: new Map([...mutations].map(([symbol, writes]) => [symbol, [...new Set([...writes].map((key) => occurrences.get(key.slice('occurrence:'.length) as OccurrenceId)!.owner))]])),
    escapes: new Set(escapes.keys()), aliases: incoming, fingerprints, evidence }
}

function escaped<Atom>(value: RuntimeValue<Atom>, state: State): RuntimeValue<Atom> {
  if (value.kind === 'alternatives') return alternatives(value.values.map((item) => escaped(item, state)), state)
  return value.kind === 'object' || value.kind === 'atom' || value.kind === 'external'
    ? { kind: 'unknown', code: 'VALUE_ESCAPE_UNSUPPORTED', reason: 'This value was passed to an unmodeled call that may mutate it.', candidates: [value] } : value
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

/** Freeze only containers created by the engine; opaque values keep their identity. */
function freezeResult(result: ValueResult<unknown>, scalar: boolean): ValueResult<unknown> {
  const value = (input: unknown): unknown => {
    if (scalar) return input
    const symbolic = input as SymbolicValue<unknown>
    return Object.freeze(symbolic.kind === 'object'
      ? { ...symbolic, properties: Object.freeze([...symbolic.properties]) }
      : { ...symbolic })
  }
  const evidence = Object.freeze([...result.evidence])
  if (result.kind === 'known') return { ...result, value: value(result.value), evidence }
  if (result.kind === 'unsupported') return { ...result, evidence }
  const reasons = Object.freeze(result.reasons.map((reason) => Object.freeze({ ...reason,
    ...('effective' in reason ? { effective: Object.freeze({ ...reason.effective }) } : {}),
  })))
  return { ...result, evidence, reasons,
    ...(result.kind === 'ambiguous' ? { values: Object.freeze(result.values.map(value)) }
      : result.candidates ? { candidates: Object.freeze(result.candidates.map(value)) } : {}),
  } as ValueResult<unknown>
}

const NEGATIVE_ZERO_ATOM = Symbol('negative-zero-atom')

/** Opaque atoms have model-owned identity, never structural JSON equality. */
function distinctValues(values: readonly unknown[], scalar: boolean): unknown[] {
  const atoms = new Set<unknown>()
  const shapes = new Set<string | undefined>()
  return values.filter((value) => {
    if (!scalar && (value as SymbolicValue<unknown>).kind === 'atom') {
      const atom = (value as Extract<SymbolicValue<unknown>, { kind: 'atom' }>).value
      const key = Object.is(atom, -0) ? NEGATIVE_ZERO_ATOM : atom
      if (atoms.has(key)) return false
      atoms.add(key)
      return true
    }
    const key = JSON.stringify(value)
    if (shapes.has(key)) return false
    shapes.add(key)
    return true
  })
}

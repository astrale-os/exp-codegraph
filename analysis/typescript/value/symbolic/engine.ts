import type { FactId, OccurrenceId, SymbolId } from '../../../identity/index.ts'
import type { AnalysisQuery } from '../../../query/index.ts'
import type { BodyOccurrence, ResolvedCall, TypeScriptCallInventory, TypeScriptCallQuery } from '../../body/index.ts'
import type { TypeScriptFact } from '../../facts/index.ts'
import { loadValueIndex, type ValueIndex as Index } from './facts.ts'
import type { BoundedValueEvaluator, BoundedValueEvaluatorOptions, BoundedValueLimits, EvaluatedValueResult, ValueResult } from '../model.ts'
import { resolveBoundedValueLimits } from '../limits.ts'
import type { SymbolicCallModel, SymbolicOperandPlan, SymbolicValue, SymbolicValuePlan, SymbolicValueResolveOptions } from './model.ts'
import { createCallProjection } from './calls.ts'
import { resolutionResultBytes, type ValueDependency, type ValueIndexRevision, type ValueProofBasis, type ValueResolutionCache } from './cache.ts'

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


interface State {
  readonly limits: Readonly<Required<BoundedValueLimits>>
  readonly signal?: AbortSignal
  readonly dependencies: Set<ValueDependency>
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
  readonly basis: ValueProofBasis
}
type Proof = { readonly [PROOF]?: ProofMetadata }
const UNDEFINED = Object.freeze({ kind: 'literal' as const, value: undefined })

/** Instance-local index owner, shared by every model attached to one pinned snapshot. */
interface ValueEvaluatorFactory {
  <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>): Promise<BoundedValueEvaluator<Atom>>
  calls(options?: TypeScriptCallQuery): Promise<TypeScriptCallInventory>
  dispose(): void
}

export function createValueEvaluatorFactory(query: AnalysisQuery, cache?: ValueResolutionCache, load?: () => Promise<Index>): ValueEvaluatorFactory {
  let pending: Promise<Index> | undefined
  let context: ProofContext | undefined
  const index = load ?? (() => {
    pending ??= loadValueIndex(query).catch((error) => { pending = undefined; throw error })
    return pending
  })
  const calls = createCallProjection(query, index)
  return Object.assign(async <Atom = never>(options: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'> = {}) => {
    const materialized = await index()
    context ??= createProofContext(materialized, cache)
    return new Evaluator(materialized, options.call, resolveBoundedValueLimits(options.limits), context, cache)
  },
  { calls, dispose() { pending = undefined; context = undefined; calls.dispose() } })
}

interface ProofContext {
  readonly revision: ValueIndexRevision
  dependency(key: string): ValueDependency
  valid(basis: ValueProofBasis): boolean
}

function createProofContext(index: Index, cache?: ValueResolutionCache): ProofContext {
  const witnesses = new Map<string, ValueDependency>()
  const validations = new WeakMap<ValueProofBasis, boolean>()
  return {
    revision: index.revision,
    dependency(key) {
      const supplied = index.dependency(key)
      if (supplied.fingerprint !== undefined) return cache?.dependency(supplied) ?? supplied
      let witness = witnesses.get(supplied.key)
      if (!witness) {
        witness = supplied
        witnesses.set(supplied.key, witness)
      }
      return cache?.dependency(witness) ?? witness
    },
    valid(basis) {
      const previous = validations.get(basis)
      if (previous !== undefined) return previous
      for (const { key, fingerprint } of basis.dependencies) if (index.fingerprints.get(key) !== fingerprint) {
        validations.set(basis, false)
        return false
      }
      validations.set(basis, true)
      return true
    },
  }
}

class Evaluator<Atom> implements BoundedValueEvaluator<Atom> {
  readonly #index: Index
  readonly #model: SymbolicCallModel<Atom> | undefined
  readonly #limits: Readonly<Required<BoundedValueLimits>>
  readonly #cache: ValueResolutionCache | undefined
  readonly #context: ProofContext
  readonly #operands = new WeakMap<SymbolicOperandPlan<Atom>, { readonly state: State; readonly read: () => RuntimeValue<Atom> }>()

  constructor(index: Index, model: SymbolicCallModel<Atom> | undefined, limits: Readonly<Required<BoundedValueLimits>>, context: ProofContext, cache?: ValueResolutionCache) {
    this.#index = index
    this.#model = model
    this.#limits = limits
    this.#cache = cache
    this.#context = context
  }

  value(occurrence: OccurrenceId): SymbolicValuePlan<Atom> { return this.plan({ kind: 'value', occurrence }) }

  canReuse(proof: EvaluatedValueResult<unknown>): boolean {
    return this.reusable(proof, this.#limits)
  }

  private reusable(proof: EvaluatedValueResult<unknown>, limits: Readonly<Required<BoundedValueLimits>>): boolean {
    const metadata = (proof as Proof)[PROOF]
    if (!metadata || metadata.model !== this.#model ||
      proof.limits.maximumDepth !== limits.maximumDepth || proof.limits.maximumSteps !== limits.maximumSteps ||
      proof.limits.maximumAlternatives !== limits.maximumAlternatives) return false
    return this.#context.valid(metadata.basis)
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
    const key = this.#cache && JSON.stringify([this.#cache.model(this.#model), scalar, limits.maximumDepth,
      limits.maximumSteps, limits.maximumAlternatives, ...planParts(plan)])
    const cached = key && this.#cache?.get(key, (proof) => this.reusable(proof, limits), this.#context.revision)
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
    const basis = this.#cache?.basis(state.dependencies, bounded.evidence, state.limits) ?? Object.freeze({
      key: '', dependencies: Object.freeze([...state.dependencies]), evidence: Object.freeze([...bounded.evidence]), limits: state.limits,
    })
    const result = { ...freezeResult(bounded, scalar, basis.evidence), limits: basis.limits }
    const metadata: ProofMetadata = Object.freeze({
      model: this.#model,
      basis,
    })
    const resultBytes = key ? resolutionResultBytes(result, [basis.evidence, basis.limits]) : undefined
    Object.defineProperty(result, PROOF, { value: metadata })
    const frozen = Object.freeze(result)
    state.signal?.throwIfAborted()
    if (key && resultBytes !== undefined) {
      this.#cache!.put(key, frozen, resultBytes, basis)
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
      state.dependencies.add(this.#context.dependency(key))
      for (const fact of this.#index.evidence.get(key) ?? []) state.evidence.add(fact)
    }
  }
}

const FUNCTION_SYNTAX = new Set(['ArrowFunction', 'FunctionExpression', 'FunctionDeclaration', 'MethodDeclaration'])
const TRANSPARENT_SYNTAX = new Set(['ParenthesizedExpression', 'NonNullExpression', 'SatisfiesExpression', 'AsExpression', 'TypeAssertionExpression'])

function planParts<Atom>(plan: Plan<Atom>, parts: string[] = []): string[] {
  if (plan.kind === 'value') parts.push('value', plan.occurrence)
  else if (plan.kind === 'unavailable') parts.push('unavailable', plan.code, plan.reason)
  else {
    planParts(plan.input, parts)
    if (plan.kind === 'property') parts.push('property', plan.name)
    else parts.push('invoke')
  }
  return parts
}

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

function escaped<Atom>(value: RuntimeValue<Atom>, state: State): RuntimeValue<Atom> {
  if (value.kind === 'alternatives') return alternatives(value.values.map((item) => escaped(item, state)), state)
  return value.kind === 'object' || value.kind === 'atom' || value.kind === 'external'
    ? { kind: 'unknown', code: 'VALUE_ESCAPE_UNSUPPORTED', reason: 'This value was passed to an unmodeled call that may mutate it.', candidates: [value] } : value
}

/** Freeze only containers created by the engine; opaque values keep their identity. */
function freezeResult(result: ValueResult<unknown>, scalar: boolean, sharedEvidence?: readonly FactId[]): ValueResult<unknown> {
  const value = (input: unknown): unknown => {
    if (scalar) return input
    const symbolic = input as SymbolicValue<unknown>
    return Object.freeze(symbolic.kind === 'object'
      ? { ...symbolic, properties: Object.freeze([...symbolic.properties]) }
      : { ...symbolic })
  }
  const evidence = sharedEvidence ?? Object.freeze([...result.evidence])
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

import type { AnalysisFailure, AnalysisLimit } from '../../facts/index.ts'
import type { FactId, OccurrenceId, SymbolId } from '../../identity/index.ts'
import type { BodyOccurrence, FunctionBodyIR, ResolvedCall } from '../body/index.ts'
import { createTypeScriptFactReader, type TypeScriptFact } from '../facts/index.ts'
import type {
  BoundedValueEvaluator,
  BoundedValueEvaluatorOptions,
  BoundedValueLimits,
  EvaluatedValueResult,
  ValueResult,
} from './model.ts'
import { resolveBoundedValueLimits } from './limits.ts'

interface IndexedOccurrence {
  readonly occurrence: BodyOccurrence
  readonly fact: FactId
}

interface EvaluatorIndex {
  readonly occurrences: ReadonlyMap<OccurrenceId, IndexedOccurrence>
  readonly children: ReadonlyMap<OccurrenceId, ReadonlyMap<string, readonly OccurrenceId[]>>
  readonly parents: ReadonlyMap<OccurrenceId, readonly { parent: OccurrenceId; role: string }[]>
  readonly definitions: ReadonlyMap<OccurrenceId, readonly OccurrenceId[]>
  readonly incoming: ReadonlyMap<SymbolId, readonly OccurrenceId[]>
  readonly calls: ReadonlyMap<OccurrenceId, ResolvedCall>
  readonly bodies: ReadonlyMap<SymbolId, { readonly body: FunctionBodyIR; readonly fact: FactId }>
  readonly direct: ReadonlyMap<OccurrenceId, ValueResult<unknown>>
}

export async function createBoundedValueEvaluator(
  options: BoundedValueEvaluatorOptions,
): Promise<BoundedValueEvaluator> {
  const limits = resolveBoundedValueLimits(options.limits)
  const facts: TypeScriptFact<'body'>[] = []
  for await (const fact of createTypeScriptFactReader(options.query).export('body')) {
    facts.push(fact)
  }
  return new PortableBoundedValueEvaluator(indexFacts(facts), limits)
}

class PortableBoundedValueEvaluator implements BoundedValueEvaluator {
  readonly #index: EvaluatorIndex
  readonly #limits: Required<BoundedValueLimits>

  constructor(
    index: EvaluatorIndex,
    limits: Required<BoundedValueLimits>,
  ) {
    this.#index = index
    this.#limits = limits
  }

  async evaluate<Value = unknown>(
    occurrence: OccurrenceId,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<EvaluatedValueResult<Value>> {
    options.signal?.throwIfAborted()
    const state = { steps: 0, memo: new Map<OccurrenceId, ValueResult<unknown>>() }
    const result = this.visit(
      occurrence,
      0,
      new Set(),
      state,
      options.signal,
      new Map(),
    ) as ValueResult<Value>
    return { ...result, limits: this.#limits }
  }

  private visit(
    occurrence: OccurrenceId,
    depth: number,
    active: ReadonlySet<OccurrenceId>,
    state: { steps: number; memo: Map<OccurrenceId, ValueResult<unknown>> },
    signal?: AbortSignal,
    environment: ReadonlyMap<SymbolId, OccurrenceId> = new Map(),
  ): ValueResult<unknown> {
    signal?.throwIfAborted()
    const cacheable = environment.size === 0
    const cached = cacheable ? state.memo.get(occurrence) : undefined
    if (cached) return cached
    if (++state.steps > this.#limits.maximumSteps) {
      return unknown('VALUE_STEP_LIMIT', 'Bounded value evaluation exceeded its step limit.', [], {
        maximumSteps: this.#limits.maximumSteps,
      })
    }
    if (depth > this.#limits.maximumDepth) {
      return unknown('VALUE_DEPTH_LIMIT', 'Bounded value evaluation exceeded its depth limit.', [], {
        maximumDepth: this.#limits.maximumDepth,
      })
    }
    if (active.has(occurrence)) {
      return unknown('VALUE_RECURSION', 'Value propagation encountered a recursive occurrence.', [])
    }
    const indexed = this.#index.occurrences.get(occurrence)
    if (!indexed) {
      return unknown('VALUE_OCCURRENCE_MISSING', `Occurrence ${occurrence} is unavailable.`, [])
    }
    const nextActive = new Set(active).add(occurrence)
    const evidence = [indexed.fact]
    const direct = addEvidence(this.#index.direct.get(occurrence), evidence)
    if (direct?.kind === 'known' || direct?.kind === 'ambiguous') {
      if (cacheable) state.memo.set(occurrence, direct)
      return direct
    }

    const call = this.#index.calls.get(occurrence)
    if (call) {
      const result = this.evaluateCall(
        call,
        depth,
        nextActive,
        state,
        signal,
        evidence,
        environment,
      )
      if (cacheable && (result.kind !== 'unknown' || direct === undefined)) {
        state.memo.set(occurrence, result)
      }
      if (result.kind !== 'unknown' || direct === undefined) return result
    }

    const occurrenceValue = indexed.occurrence
    const candidates: OccurrenceId[] = []
    if (occurrenceValue.kind === 'use') {
      candidates.push(...(this.#index.definitions.get(occurrence) ?? []))
    }
    if (occurrenceValue.kind === 'definition' && occurrenceValue.symbol) {
      const bound = environment.get(occurrenceValue.symbol)
      if (bound) candidates.push(bound)
      else candidates.push(...(this.#index.incoming.get(occurrenceValue.symbol) ?? []))
    }
    for (const parent of this.#index.parents.get(occurrence) ?? []) {
      if (parent.role !== 'name') continue
      candidates.push(...this.children(parent.parent, 'initializer'))
    }
    candidates.push(...this.children(occurrence, 'initializer'))
    candidates.push(...this.children(occurrence, 'expression'))
    candidates.push(...this.children(occurrence, 'right'))
    if (candidates.length) {
      const result = this.combine(
        unique(candidates).map((candidate) =>
          this.visit(candidate, depth + 1, nextActive, state, signal, environment),
        ),
        evidence,
      )
      if (cacheable) state.memo.set(occurrence, result)
      return result
    }

    const result =
      direct ??
      unknown(
        'VALUE_NO_SEMANTIC_PATH',
        `No bounded value path is available for ${occurrenceValue.syntax}.`,
        evidence,
      )
    if (cacheable) state.memo.set(occurrence, result)
    return result
  }

  private evaluateCall(
    call: ResolvedCall,
    depth: number,
    active: ReadonlySet<OccurrenceId>,
    state: { steps: number; memo: Map<OccurrenceId, ValueResult<unknown>> },
    signal: AbortSignal | undefined,
    evidence: readonly FactId[],
    environment: ReadonlyMap<SymbolId, OccurrenceId>,
  ): ValueResult<unknown> {
    if (call.dynamic || !call.target) {
      return unknown('VALUE_DYNAMIC_CALL', 'The call target is unresolved or dynamic.', evidence)
    }
    const target = this.#index.bodies.get(call.target)
    if (!target) {
      return {
        kind: 'unsupported',
        construct: 'external-or-bodyless-call',
        evidence: unique([...evidence]),
      }
    }
    if (target.body.summary.recursion) {
      return unknown('VALUE_RECURSION', 'The target function is recursive.', [...evidence, target.fact])
    }
    const returned = target.body.summary.returns.flatMap((occurrence) =>
      this.children(occurrence, 'expression'),
    )
    if (!returned.length) {
      return unknown(
        'VALUE_RETURN_MISSING',
        'The target function has no value-bearing return occurrence.',
        [...evidence, target.fact],
      )
    }
    const bindings = new Map(environment)
    for (const binding of call.bindings) {
      if (binding.parameter) bindings.set(binding.parameter, binding.argument)
    }
    return this.combine(
      returned.map((occurrence) =>
        this.visit(occurrence, depth + 1, active, state, signal, bindings),
      ),
      [...evidence, target.fact],
    )
  }

  private combine(
    results: readonly ValueResult<unknown>[],
    enclosingEvidence: readonly FactId[],
  ): ValueResult<unknown> {
    const evidence = unique([
      ...enclosingEvidence,
      ...results.flatMap((result) => [...result.evidence]),
    ])
    const unsupported = results.find((result) => result.kind === 'unsupported')
    if (unsupported) return { ...unsupported, evidence }
    const unknowns = results.filter(
      (result): result is Extract<ValueResult<unknown>, { kind: 'unknown' }> =>
        result.kind === 'unknown',
    )
    if (unknowns.length) {
      return { kind: 'unknown', reasons: uniqueReasons(unknowns.flatMap((value) => value.reasons)), evidence }
    }
    const values = deduplicateValues(
      results.flatMap((result) =>
        result.kind === 'known' ? [result.value] : result.kind === 'ambiguous' ? result.values : [],
      ),
    )
    if (values.length === 1) return { kind: 'known', value: values[0], evidence }
    const inherited = results.flatMap((result) =>
      result.kind === 'ambiguous' ? [...result.reasons] : [],
    )
    const truncated = values.length > this.#limits.maximumAlternatives
    const reasons: AnalysisLimit[] = [
      ...inherited,
      {
        code: truncated ? 'VALUE_ALTERNATIVE_LIMIT' : 'VALUE_ALTERNATIVES',
        message: truncated
          ? 'The result has more alternatives than the configured bound.'
          : 'Several statically reachable values remain possible.',
        effective: {
          alternatives: values.length,
          maximumAlternatives: this.#limits.maximumAlternatives,
          truncated,
        },
      },
    ]
    return {
      kind: 'ambiguous',
      values: values.slice(0, this.#limits.maximumAlternatives),
      reasons,
      evidence,
    }
  }

  private children(parent: OccurrenceId, role: string): readonly OccurrenceId[] {
    return this.#index.children.get(parent)?.get(role) ?? []
  }
}

function indexFacts(facts: readonly TypeScriptFact<'body'>[]): EvaluatorIndex {
  const occurrences = new Map<OccurrenceId, IndexedOccurrence>()
  const children = new Map<OccurrenceId, Map<string, OccurrenceId[]>>()
  const parents = new Map<OccurrenceId, { parent: OccurrenceId; role: string }[]>()
  const definitions = new Map<OccurrenceId, OccurrenceId[]>()
  const incoming = new Map<SymbolId, OccurrenceId[]>()
  const calls = new Map<OccurrenceId, ResolvedCall>()
  const bodies = new Map<SymbolId, { body: FunctionBodyIR; fact: FactId }>()
  const direct = new Map<OccurrenceId, ValueResult<unknown>>()
  for (const fact of facts) {
    const payload = fact.payload
    const body = payload.body
    bodies.set(body.function, { body, fact: fact.id })
    for (const occurrence of body.occurrences) {
      const existing = occurrences.get(occurrence.id)
      if (existing && existing.occurrence.owner !== occurrence.owner) {
        throw new Error(`Occurrence ${occurrence.id} has multiple function owners.`)
      }
      occurrences.set(occurrence.id, { occurrence, fact: fact.id })
    }
    for (const relation of body.relations) {
      appendNested(children, relation.parent, relation.role, relation.child)
      append(parents, relation.child, { parent: relation.parent, role: relation.role })
    }
    for (const relation of body.definitions) {
      append(definitions, relation.use, relation.definition)
    }
    for (const call of body.calls) {
      calls.set(call.occurrence, call)
      for (const binding of call.bindings) {
        if (binding.parameter) append(incoming, binding.parameter, binding.argument)
      }
    }
    for (const [occurrence, value] of Object.entries(payload.values)) {
      direct.set(occurrence as OccurrenceId, value)
    }
  }
  return { occurrences, children, parents, definitions, incoming, calls, bodies, direct }
}

function addEvidence(
  result: ValueResult<unknown> | undefined,
  evidence: readonly FactId[],
): ValueResult<unknown> | undefined {
  return result ? { ...result, evidence: unique([...result.evidence, ...evidence]) } : undefined
}

function unknown(
  code: string,
  message: string,
  evidence: readonly FactId[],
  effective?: Readonly<Record<string, number | string | boolean>>,
): ValueResult<never> {
  const reason: AnalysisFailure = {
    code,
    message: effective ? `${message} Effective: ${JSON.stringify(effective)}.` : message,
    retryable: false,
  }
  return { kind: 'unknown', reasons: [reason], evidence: unique([...evidence]) }
}

function append<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key)
  if (values) values.push(value)
  else map.set(key, [value])
}

function appendNested<Key, InnerKey, Value>(
  map: Map<Key, Map<InnerKey, Value[]>>,
  key: Key,
  inner: InnerKey,
  value: Value,
): void {
  let nested = map.get(key)
  if (!nested) {
    nested = new Map()
    map.set(key, nested)
  }
  append(nested, inner, value)
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function uniqueReasons(values: readonly AnalysisFailure[]): AnalysisFailure[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.code}\0${value.message}\0${String(value.attributableTo)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function deduplicateValues(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

import {
  deriveAnalysisId,
  factShardDigest,
  type Completeness,
  type Fact,
  type FactId,
  type FactShard,
  type OccurrenceId,
  type PortablePass,
  type SourceSpan,
  type SymbolId,
} from '@astrale-os/codegraph/analysis'
import {
  createBoundedValueEvaluator,
  createTypeScriptFactReader,
  resolveBoundedValueLimits,
  type BodyOccurrence,
  type ResolvedCall,
  type TypeScriptFact,
} from '@astrale-os/codegraph/analysis/typescript'

import {
  SDK_BUILDER_CAPABILITY,
  SDK_BUILDER_FACT_NAMESPACE,
  type SDKBuilderCallPayload,
  type SDKBuilderCallbackFact,
  type SDKBuilderPayload,
  type SDKBuilderSelector,
  type SDKBuilderSummaryPayload,
} from './model.ts'

const ACCEPTED_CALL_EXTRACTION_PARTIAL_REASONS = ['CFG_EXPRESSION_BRANCH_PARTIAL'] as const

interface BodyIndex {
  readonly fact: TypeScriptFact<'body'>
  readonly occurrences: ReadonlyMap<OccurrenceId, BodyOccurrence>
  readonly relations: ReadonlyMap<OccurrenceId, readonly { child: OccurrenceId; role: string }[]>
}

interface Candidate {
  readonly call: ResolvedCall
  readonly body: BodyIndex
  readonly argument: OccurrenceId
  readonly inputs: readonly TypeScriptFact<'body'>[]
  readonly forwarding: SDKBuilderCallPayload['forwarding']
}

export function createSDKBuilderAnalysisPass(selector: SDKBuilderSelector): PortablePass {
  validateSelector(selector)
  const manifest: PortablePass['manifest'] = {
    id: deriveAnalysisId('pass', 'fixture.sdk.builder-analysis', { version: 1 }),
    version: '1.0.0',
    runtime: 'portable-typescript',
    scope: 'project',
    providesCapabilities: [SDK_BUILDER_CAPABILITY],
    requiresCapabilities: ['typescript.source', 'typescript.symbol', 'typescript.body'],
    inputs: [
      { namespace: 'typescript.source', minimumVersion: 1, maximumVersion: 1 },
      { namespace: 'typescript.symbol', minimumVersion: 1, maximumVersion: 1 },
      { namespace: 'typescript.body', minimumVersion: 1, maximumVersion: 1 },
    ],
    outputs: [{ namespace: SDK_BUILDER_FACT_NAMESPACE, version: 1 }],
    invalidatesOn: ['typescript.source', 'typescript.symbol', 'typescript.body'],
    limits: {
      maximumForwardingDepth: selector.maximumForwardingDepth,
      maximumCalls: selector.maximumCalls,
    },
    mandatory: true,
  }
  return {
    manifest,
    async run(context) {
      const reader = createTypeScriptFactReader(context.query)
      const [sources, symbols, bodies] = await Promise.all([
        collect(reader.export('source')),
        collect(reader.export('symbol')),
        collect(reader.export('body')),
      ])
      const sourceById = new Map(sources.map((fact) => [fact.payload.source, fact]))
      const pathBySource = new Map(
        sources.map((fact) => [fact.payload.source, fact.payload.logicalPath] as const),
      )
      const builderSymbols = symbols.filter(
        (fact) =>
          fact.payload.name === selector.exportName &&
          fact.payload.declarations.some(
            (declaration) => pathBySource.get(declaration.source) === selector.declarationPath,
          ),
      )
      if (builderSymbols.length !== 1) {
        throw new Error(
          `Expected one canonical ${selector.exportName} declaration at ${selector.declarationPath}; found ${builderSymbols.length}.`,
        )
      }
      const builderFact = builderSymbols[0]!
      const builder = builderFact.payload.symbol
      const collisionSymbols = symbols
        .filter((fact) => fact.payload.name === selector.exportName && fact.payload.symbol !== builder)
        .map((fact) => fact.payload.symbol)
        .sort()
      const symbolNames = new Map(symbols.map((fact) => [fact.payload.symbol, fact.payload.name] as const))
      const bodyIndexes = bodies.map(indexBody)
      const bodyByFunction = new Map(bodyIndexes.map((body) => [body.fact.payload.body.function, body] as const))
      const bodyByCallableSymbol = indexCallableBodies(bodyIndexes, symbols)
      const direct = directCandidates(bodyIndexes, builder)
      const forwarded = forwardedCandidates(bodyIndexes, bodyByFunction, builder)
      const candidates = [...direct, ...forwarded].sort((left, right) =>
        left.call.occurrence.localeCompare(right.call.occurrence),
      )
      if (candidates.length > selector.maximumCalls) {
        throw new Error(`SDK builder analysis exceeded ${selector.maximumCalls} calls.`)
      }
      const evaluator = await createBoundedValueEvaluator({ query: context.query })
      const facts: Fact<SDKBuilderPayload>[] = []
      for (const candidate of candidates) {
        context.signal?.throwIfAborted()
        const valueInitializer = propertyInitializer(
          candidate.body,
          candidate.argument,
          selector.valueProperty,
          symbolNames,
        )
        const value = valueInitializer
          ? await evaluator.evaluate(valueInitializer, { signal: context.signal })
          : missingValue(selector.valueProperty)
        const callbackInitializer = propertyInitializer(
          candidate.body,
          candidate.argument,
          selector.callbackProperty,
          symbolNames,
        )
        const callbacks = callbackInitializer
          ? callbackFacts(
              callbackInitializer,
              candidate.body,
              bodyByFunction,
              bodyByCallableSymbol,
            )
          : []
        const source = candidate.body.occurrences.get(candidate.call.occurrence)?.span
        if (!source) throw new Error(`Builder call ${candidate.call.occurrence} has no source span.`)
        const inputCompleteness = mergeCompleteness(
          candidate.inputs.map((fact) => fact.completeness),
        )
        const completeness = callExtractionCompleteness(inputCompleteness)
        const inputs = unique([
          builderFact.id,
          ...builderFact.payload.declarations.flatMap((declaration) => {
            const sourceFact = sourceById.get(declaration.source)
            return sourceFact ? [sourceFact.id] : []
          }),
          ...candidate.inputs.map((fact) => fact.id),
          ...value.evidence,
        ])
        const payload: SDKBuilderCallPayload = {
          kind: 'builder-call',
          call: candidate.call.occurrence,
          builder,
          source,
          forwarding: candidate.forwarding,
          value,
          callbacks,
          inputCompleteness,
          acceptedInputPartialReasons:
            inputCompleteness.kind === 'partial'
              ? inputCompleteness.reasons
                  .filter((reason) => ACCEPTED_CALL_EXTRACTION_PARTIAL_REASONS.includes(
                    reason.code as (typeof ACCEPTED_CALL_EXTRACTION_PARTIAL_REASONS)[number],
                  ))
                  .map((reason) => reason.code)
                  .sort()
              : [],
        }
        facts.push(
          makeFact(
            context.generation.id,
            manifest,
            'sdk-builder-call',
            candidate.call.occurrence,
            payload,
            completeness,
            [source],
            inputs,
          ),
        )
      }
      const allCalls = bodyIndexes.flatMap((body) =>
        body.fact.payload.body.calls.map((call) => ({ body, call })),
      )
      const rejectedCollisionCalls = allCalls.filter(
        ({ call }) => call.target && collisionSymbols.includes(call.target),
      )
      const corpusCompleteness = callExtractionCompleteness(
        mergeCompleteness(bodies.map((fact) => fact.completeness)),
      )
      const summary: SDKBuilderSummaryPayload = {
        kind: 'builder-summary',
        builder,
        declarationPath: selector.declarationPath,
        exportName: selector.exportName,
        directCalls: direct.length,
        forwardedCalls: forwarded.length,
        collisionSymbols,
        rejectedCollisionCalls: rejectedCollisionCalls.length,
      }
      facts.push(
        makeFact(
          context.generation.id,
          manifest,
          'sdk-builder-summary',
          builder,
          summary,
          corpusCompleteness,
          builderFact.provenance.evidence,
          unique([
            builderFact.id,
            ...candidates.flatMap((candidate) => candidate.inputs.map((fact) => fact.id)),
            ...rejectedCollisionCalls.map(({ body }) => body.fact.id),
          ]),
        ),
      )
      facts.sort((left, right) => left.id.localeCompare(right.id))
      const completion = mergeCompleteness(facts.map((fact) => fact.completeness))
      const draft = {
        key: deriveAnalysisId('fact-shard-key', SDK_BUILDER_FACT_NAMESPACE, {
          pass: manifest.id,
          universe: context.generation.universe,
        }),
        namespace: SDK_BUILDER_FACT_NAMESPACE,
        schemaVersion: 1,
        completion,
        facts,
      }
      const shard: FactShard = { ...draft, digest: factShardDigest(draft) }
      return { completion, shards: [shard], diagnostics: [] }
    },
  }
}

function directCandidates(bodies: readonly BodyIndex[], builder: SymbolId): Candidate[] {
  return bodies.flatMap((body) =>
    body.fact.payload.body.calls
      .filter((call) => call.target === builder && call.arguments[0])
      .map((call) => ({
        call,
        body,
        argument: call.arguments[0]!,
        inputs: [body.fact],
        forwarding: { kind: 'direct' as const },
      })),
  )
}

function forwardedCandidates(
  bodies: readonly BodyIndex[],
  bodyByFunction: ReadonlyMap<SymbolId, BodyIndex>,
  builder: SymbolId,
): Candidate[] {
  const values: Candidate[] = []
  for (const outerBody of bodies) {
    for (const outerCall of outerBody.fact.payload.body.calls) {
      if (!outerCall.target || outerCall.target === builder) continue
      const wrapper = bodyByFunction.get(outerCall.target)
      if (!wrapper) continue
      const builderBindings = outerCall.bindings.filter((binding) => {
        const argument = outerBody.occurrences.get(binding.argument)
        return argument?.symbol === builder && binding.parameter
      })
      for (const builderBinding of builderBindings) {
        for (const innerCall of wrapper.fact.payload.body.calls) {
          if (innerCall.target !== builderBinding.parameter || !innerCall.arguments[0]) continue
          const innerArgument = wrapper.occurrences.get(innerCall.arguments[0]!)
          const outerArgument = outerCall.bindings.find(
            (binding) => binding.parameter && binding.parameter === innerArgument?.symbol,
          )?.argument
          if (!outerArgument) continue
          values.push({
            call: outerCall,
            body: outerBody,
            argument: outerArgument,
            inputs: [outerBody.fact, wrapper.fact],
            forwarding: { kind: 'one-hop', wrapper: outerCall.target },
          })
        }
      }
    }
  }
  return values
}

function propertyInitializer(
  body: BodyIndex,
  object: OccurrenceId,
  property: string,
  symbolNames: ReadonlyMap<SymbolId, string>,
): OccurrenceId | undefined {
  for (const relation of body.relations.get(object) ?? []) {
    if (!relation.role.startsWith('property:')) continue
    const propertyRelations = body.relations.get(relation.child) ?? []
    const name = propertyRelations
      .filter((candidate) => candidate.role === 'name')
      .map((candidate) => body.occurrences.get(candidate.child)?.symbol)
      .find((symbol): symbol is SymbolId => !!symbol)
    if (name && symbolNames.get(name) === property) {
      return propertyRelations.find((candidate) => candidate.role === 'initializer')?.child
    }
  }
  return
}

function callbackFacts(
  initializer: OccurrenceId,
  body: BodyIndex,
  bodyByFunction: ReadonlyMap<SymbolId, BodyIndex>,
  bodyByCallableSymbol: ReadonlyMap<SymbolId, BodyIndex>,
): readonly SDKBuilderCallbackFact[] {
  const occurrence = body.occurrences.get(initializer)
  if (occurrence?.symbol) {
    const targetBody = bodyByCallableSymbol.get(occurrence.symbol)
    return [
      {
        kind: 'direct',
        target: targetBody?.fact.payload.body.function ?? occurrence.symbol,
        bodyAvailable: !!targetBody,
        resolvedReturns: [],
      },
    ]
  }
  const call = body.fact.payload.body.calls.find((candidate) => candidate.occurrence === initializer)
  if (!call?.target) return []
  const targetBody = bodyByFunction.get(call.target)
  return [
    {
      kind: 'returned',
      target: call.target,
      bodyAvailable: !!targetBody,
      resolvedReturns: targetBody
        ? returnedFunctionSymbols(targetBody, bodyByCallableSymbol)
        : [],
    },
  ]
}

function returnedFunctionSymbols(
  body: BodyIndex,
  bodyByCallableSymbol: ReadonlyMap<SymbolId, BodyIndex>,
): readonly SymbolId[] {
  const values: SymbolId[] = []
  for (const returned of body.fact.payload.body.summary.returns) {
    for (const relation of body.relations.get(returned) ?? []) {
      if (relation.role !== 'expression') continue
      const symbol = body.occurrences.get(relation.child)?.symbol
      const target = symbol ? bodyByCallableSymbol.get(symbol) : undefined
      if (target) values.push(target.fact.payload.body.function)
    }
  }
  return unique(values)
}

function indexCallableBodies(
  bodies: readonly BodyIndex[],
  symbols: readonly TypeScriptFact<'symbol'>[],
): ReadonlyMap<SymbolId, BodyIndex> {
  const values = new Map<SymbolId, BodyIndex>(
    bodies.map((body) => [body.fact.payload.body.function, body] as const),
  )
  for (const symbol of symbols) {
    const candidates = bodies.filter((body) =>
      symbol.payload.declarations.some((declaration) =>
        body.fact.provenance.evidence.some(
          (evidence) =>
            evidence.source === declaration.source &&
            evidence.revision === declaration.revision &&
            declaration.start <= evidence.start &&
            evidence.end <= declaration.end,
        ),
      ),
    )
    if (candidates.length === 1) values.set(symbol.payload.symbol, candidates[0]!)
  }
  return values
}

function indexBody(fact: TypeScriptFact<'body'>): BodyIndex {
  const relations = new Map<OccurrenceId, { child: OccurrenceId; role: string }[]>()
  for (const relation of fact.payload.body.relations) {
    const current = relations.get(relation.parent) ?? []
    current.push({ child: relation.child, role: relation.role })
    relations.set(relation.parent, current)
  }
  return {
    fact,
    occurrences: new Map(fact.payload.body.occurrences.map((occurrence) => [occurrence.id, occurrence])),
    relations,
  }
}

function makeFact<Payload extends SDKBuilderPayload>(
  generation: Fact['generation'],
  manifest: PortablePass['manifest'],
  kind: string,
  subject: string,
  payload: Payload,
  completeness: Completeness,
  evidence: readonly SourceSpan[],
  inputs: readonly FactId[],
): Fact<Payload> {
  return {
    id: deriveAnalysisId('fact', SDK_BUILDER_FACT_NAMESPACE, { kind, subject, payload, inputs }),
    generation,
    namespace: SDK_BUILDER_FACT_NAMESPACE,
    schemaVersion: 1,
    kind,
    subject,
    completeness,
    provenance: {
      pass: manifest.id,
      passVersion: manifest.version,
      evidence: uniqueSpans(evidence),
      inputs: unique(inputs),
    },
    payload,
  }
}

function callExtractionCompleteness(value: Completeness): Completeness {
  if (value.kind !== 'partial') return value
  return value.reasons.every((reason) =>
    ACCEPTED_CALL_EXTRACTION_PARTIAL_REASONS.includes(
      reason.code as (typeof ACCEPTED_CALL_EXTRACTION_PARTIAL_REASONS)[number],
    ),
  )
    ? { kind: 'complete' }
    : value
}

function mergeCompleteness(values: readonly Completeness[]): Completeness {
  const unavailable = values.flatMap((value) =>
    value.kind === 'unavailable' ? value.reasons : [],
  )
  if (unavailable.length) return { kind: 'unavailable', reasons: uniqueReasons(unavailable) }
  const partial = values.flatMap((value) => (value.kind === 'partial' ? value.reasons : []))
  return partial.length ? { kind: 'partial', reasons: uniqueReasons(partial) } : { kind: 'complete' }
}

function missingValue(property: string): SDKBuilderCallPayload['value'] {
  return {
    kind: 'unknown',
    reasons: [
      {
        code: 'SDK_BUILDER_PROPERTY_MISSING',
        message: `Builder options do not contain ${property}.`,
        retryable: false,
      },
    ],
    evidence: [],
    limits: resolveBoundedValueLimits(),
  }
}

function validateSelector(selector: SDKBuilderSelector): void {
  if (
    !selector.declarationPath ||
    !selector.exportName ||
    !selector.valueProperty ||
    !selector.callbackProperty ||
    selector.maximumForwardingDepth !== 1 ||
    !Number.isSafeInteger(selector.maximumCalls) ||
    selector.maximumCalls < 1
  ) {
    throw new Error('Invalid SDK builder selector.')
  }
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const output: Value[] = []
  for await (const value of values) output.push(value)
  return output
}

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort()
}

function uniqueSpans(values: readonly SourceSpan[]): SourceSpan[] {
  return [
    ...new Map(
      values.map((span) => [
        `${span.source}\0${span.revision}\0${span.start}\0${span.end}`,
        span,
      ] as const),
    ).values(),
  ].sort((left, right) =>
    `${left.source}\0${left.start}\0${left.end}`.localeCompare(
      `${right.source}\0${right.start}\0${right.end}`,
    ),
  )
}

function uniqueReasons<Value extends { readonly code: string; readonly message: string }>(
  values: readonly Value[],
): Value[] {
  return [
    ...new Map(values.map((value) => [`${value.code}\0${value.message}`, value] as const)).values(),
  ].sort((left, right) => left.code.localeCompare(right.code))
}

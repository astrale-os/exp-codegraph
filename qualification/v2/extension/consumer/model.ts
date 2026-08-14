import type {
  Completeness,
  Fact,
  FactId,
  OccurrenceId,
  SourceSpan,
  SymbolId,
} from '@astrale-os/codegraph/analysis'
import type { EvaluatedValueResult } from '@astrale-os/codegraph/analysis/typescript'

export const SDK_BUILDER_FACT_NAMESPACE = 'fixture.sdk.builder-call' as const
export const SDK_BUILDER_CAPABILITY = 'fixture.sdk.builder-analysis' as const

export interface SDKBuilderSelector {
  readonly declarationPath: string
  readonly exportName: string
  readonly valueProperty: string
  readonly callbackProperty: string
  readonly maximumForwardingDepth: 1
  readonly maximumCalls: number
}

export interface SDKBuilderCallbackFact {
  readonly kind: 'direct' | 'returned'
  readonly target: SymbolId
  readonly bodyAvailable: boolean
  readonly resolvedReturns: readonly SymbolId[]
}

export interface SDKBuilderCallPayload {
  readonly kind: 'builder-call'
  readonly call: OccurrenceId
  readonly builder: SymbolId
  readonly source: SourceSpan
  readonly forwarding:
    | { readonly kind: 'direct' }
    | { readonly kind: 'one-hop'; readonly wrapper: SymbolId }
  readonly value: EvaluatedValueResult<unknown>
  readonly callbacks: readonly SDKBuilderCallbackFact[]
  readonly inputCompleteness: Completeness
  readonly acceptedInputPartialReasons: readonly string[]
}

export interface SDKBuilderSummaryPayload {
  readonly kind: 'builder-summary'
  readonly builder: SymbolId
  readonly declarationPath: string
  readonly exportName: string
  readonly directCalls: number
  readonly forwardedCalls: number
  readonly collisionSymbols: readonly SymbolId[]
  readonly rejectedCollisionCalls: number
}

export type SDKBuilderPayload = SDKBuilderCallPayload | SDKBuilderSummaryPayload
export type SDKBuilderFact = Fact<SDKBuilderPayload>

export interface SDKBuilderPolicyExpectation {
  readonly directCalls: number
  readonly forwardedCalls: number
  readonly minimumRejectedCollisions: number
  readonly valueStates: readonly SDKBuilderCallPayload['value']['kind'][]
  readonly knownValues: readonly string[]
  readonly callbackKinds: readonly SDKBuilderCallbackFact['kind'][]
}

export interface SDKBuilderAnalysisSnapshot {
  readonly summary: Fact<SDKBuilderSummaryPayload>
  readonly calls: readonly Fact<SDKBuilderCallPayload>[]
  readonly completeness: Completeness
}

export function isSDKBuilderFact(value: Fact): value is SDKBuilderFact {
  if (value.namespace !== SDK_BUILDER_FACT_NAMESPACE || value.schemaVersion !== 1) return false
  if (!record(value.payload)) return false
  if (value.payload.kind === 'builder-summary') {
    return (
      string(value.payload.builder) &&
      string(value.payload.declarationPath) &&
      string(value.payload.exportName) &&
      nonNegativeInteger(value.payload.directCalls) &&
      nonNegativeInteger(value.payload.forwardedCalls) &&
      strings(value.payload.collisionSymbols) &&
      nonNegativeInteger(value.payload.rejectedCollisionCalls)
    )
  }
  if (value.payload.kind !== 'builder-call') return false
  return (
    string(value.payload.call) &&
    string(value.payload.builder) &&
    sourceSpan(value.payload.source) &&
    record(value.payload.forwarding) &&
    (value.payload.forwarding.kind === 'direct' ||
      (value.payload.forwarding.kind === 'one-hop' && string(value.payload.forwarding.wrapper))) &&
    valueResult(value.payload.value) &&
    Array.isArray(value.payload.callbacks) &&
    value.payload.callbacks.every(callback) &&
    completeness(value.payload.inputCompleteness) &&
    strings(value.payload.acceptedInputPartialReasons)
  )
}

export function builderFactInputs(facts: readonly SDKBuilderFact[]): readonly FactId[] {
  return [...new Set(facts.flatMap((fact) => fact.provenance.inputs))].sort()
}

function callback(value: unknown): boolean {
  return (
    record(value) &&
    (value.kind === 'direct' || value.kind === 'returned') &&
    string(value.target) &&
    typeof value.bodyAvailable === 'boolean' &&
    strings(value.resolvedReturns)
  )
}

function valueResult(value: unknown): boolean {
  return (
    record(value) &&
    ['known', 'unknown', 'ambiguous', 'unsupported'].includes(String(value.kind)) &&
    strings(value.evidence) &&
    record(value.limits) &&
    positiveInteger(value.limits.maximumDepth) &&
    positiveInteger(value.limits.maximumSteps) &&
    positiveInteger(value.limits.maximumAlternatives)
  )
}

function completeness(value: unknown): value is Completeness {
  return (
    record(value) &&
    (value.kind === 'complete' ||
      ((value.kind === 'partial' || value.kind === 'unavailable') && Array.isArray(value.reasons)))
  )
}

function sourceSpan(value: unknown): value is SourceSpan {
  return (
    record(value) &&
    string(value.source) &&
    string(value.revision) &&
    nonNegativeInteger(value.start) &&
    positiveInteger(value.end) &&
    Number(value.end) > Number(value.start)
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string)
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1
}

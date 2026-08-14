import {
  deriveAnalysisId,
  type AnalysisPolicy,
  type Completeness,
  type PolicyDiagnostic,
  type PolicyRuleResult,
} from '@astrale-os/codegraph/analysis'

import {
  SDK_BUILDER_CAPABILITY,
  SDK_BUILDER_FACT_NAMESPACE,
  isSDKBuilderFact,
  type SDKBuilderAnalysisSnapshot,
  type SDKBuilderFact,
  type SDKBuilderPolicyExpectation,
} from './model.ts'

const RULES = [
  'SDK-BUILDER-IDENTITY',
  'SDK-BUILDER-VALUES',
  'SDK-BUILDER-CALLBACKS',
  'SDK-BUILDER-FORWARDING',
] as const

export function createSDKBuilderQualificationPolicy(
  expected: SDKBuilderPolicyExpectation,
): AnalysisPolicy {
  return {
    manifest: {
      id: deriveAnalysisId('policy', 'fixture.sdk.builder-qualification', { version: 1 }),
      version: '1.0.0',
      requiresCapabilities: [],
      scopedCapabilities: [SDK_BUILDER_CAPABILITY],
      inputs: [
        { namespace: SDK_BUILDER_FACT_NAMESPACE, minimumVersion: 1, maximumVersion: 1 },
      ],
      rules: RULES,
      limits: {},
    },
    async evaluate(context) {
      const facts: SDKBuilderFact[] = []
      for await (const fact of context.query.export({ namespaces: [SDK_BUILDER_FACT_NAMESPACE] })) {
        if (!isSDKBuilderFact(fact)) {
          throw new Error(`SDK builder policy received invalid fact ${fact.id}.`)
        }
        facts.push(fact)
      }
      const summaries = facts.filter(
        (fact): fact is SDKBuilderAnalysisSnapshot['summary'] => fact.payload.kind === 'builder-summary',
      )
      const calls = facts.filter(
        (fact): fact is SDKBuilderAnalysisSnapshot['calls'][number] => fact.payload.kind === 'builder-call',
      )
      if (summaries.length !== 1) throw new Error(`Expected one SDK builder summary; found ${summaries.length}.`)
      const completeness = mergeCompleteness([
        context.capability(SDK_BUILDER_CAPABILITY) ?? unavailable('SDK capability is missing.'),
        ...facts.map((fact) => fact.completeness),
      ])
      const snapshot: SDKBuilderAnalysisSnapshot = { summary: summaries[0]!, calls, completeness }
      if (completeness.kind !== 'complete') {
        return RULES.map((rule) => incompleteRule(rule, completeness))
      }
      return [
        identityRule(snapshot, expected),
        valuesRule(snapshot, expected),
        callbacksRule(snapshot, expected),
        forwardingRule(snapshot, expected),
      ]
    },
  }
}

function identityRule(
  snapshot: SDKBuilderAnalysisSnapshot,
  expected: SDKBuilderPolicyExpectation,
): PolicyRuleResult {
  const summary = snapshot.summary.payload
  const selected = snapshot.calls.every((fact) => fact.payload.builder === summary.builder)
  const matches =
    selected &&
    summary.directCalls === expected.directCalls &&
    summary.forwardedCalls === expected.forwardedCalls &&
    summary.rejectedCollisionCalls >= expected.minimumRejectedCollisions
  return result(
    RULES[0],
    matches,
    snapshot,
    matches
      ? []
      : [
          diagnostic(RULES[0], 'SDK_BUILDER_IDENTITY_MISMATCH', 'Canonical builder selection or collision rejection did not match the qualified contract.'),
        ],
  )
}

function valuesRule(
  snapshot: SDKBuilderAnalysisSnapshot,
  expected: SDKBuilderPolicyExpectation,
): PolicyRuleResult {
  const states = unique(snapshot.calls.map((fact) => fact.payload.value.kind))
  const known = unique(
    snapshot.calls.flatMap((fact) =>
      fact.payload.value.kind === 'known' && typeof fact.payload.value.value === 'string'
        ? [fact.payload.value.value]
        : [],
    ),
  )
  const matches = same(states, unique(expected.valueStates)) &&
    expected.knownValues.every((value) => known.includes(value))
  return result(
    RULES[1],
    matches,
    snapshot,
    matches
      ? []
      : [diagnostic(RULES[1], 'SDK_BUILDER_VALUE_STATES_MISSING', 'The bounded builder values did not expose every qualified state and witness.')],
  )
}

function callbacksRule(
  snapshot: SDKBuilderAnalysisSnapshot,
  expected: SDKBuilderPolicyExpectation,
): PolicyRuleResult {
  const callbacks = snapshot.calls.flatMap((fact) => fact.payload.callbacks)
  const kinds = unique(callbacks.map((callback) => callback.kind))
  const matches =
    expected.callbackKinds.every((kind) => kinds.includes(kind)) &&
    callbacks.every((callback) => callback.bodyAvailable) &&
    callbacks.some((callback) => callback.kind === 'returned' && callback.resolvedReturns.length > 0)
  return result(
    RULES[2],
    matches,
    snapshot,
    matches
      ? []
      : [diagnostic(RULES[2], 'SDK_BUILDER_CALLBACK_BODY_MISSING', 'Callback bodies or returned callback provenance are incomplete.')],
  )
}

function forwardingRule(
  snapshot: SDKBuilderAnalysisSnapshot,
  expected: SDKBuilderPolicyExpectation,
): PolicyRuleResult {
  const forwarded = snapshot.calls.filter((fact) => fact.payload.forwarding.kind === 'one-hop')
  const matches =
    forwarded.length === expected.forwardedCalls &&
    forwarded.every(
      (fact) => fact.payload.value.kind === 'known' && fact.payload.value.value === 'forwarded',
    )
  return result(
    RULES[3],
    matches,
    snapshot,
    matches
      ? []
      : [diagnostic(RULES[3], 'SDK_BUILDER_FORWARDING_MISMATCH', 'One-hop builder forwarding did not preserve the canonical target and value.')],
  )
}

function result(
  rule: string,
  matches: boolean,
  snapshot: SDKBuilderAnalysisSnapshot,
  diagnostics: readonly PolicyDiagnostic[],
): PolicyRuleResult {
  return {
    rule,
    status: matches ? 'pass' : 'fail',
    diagnostics,
    matched: matches ? 1 : 0,
    total: 1,
    evidenceCompleteness: snapshot.completeness,
  }
}

function incompleteRule(rule: string, completeness: Completeness): PolicyRuleResult {
  return {
    rule,
    status: 'indeterminate',
    diagnostics: [
      diagnostic(rule, 'SDK_BUILDER_EVIDENCE_INCOMPLETE', `SDK builder evidence is ${completeness.kind}.`),
    ],
    matched: 0,
    total: 0,
    evidenceCompleteness: completeness,
  }
}

function diagnostic(rule: string, code: string, message: string): PolicyDiagnostic {
  return { code, severity: 'error', message, rule, evidence: [], inputs: [] }
}

function mergeCompleteness(values: readonly Completeness[]): Completeness {
  const unavailableReasons = values.flatMap((value) => value.kind === 'unavailable' ? value.reasons : [])
  if (unavailableReasons.length) return { kind: 'unavailable', reasons: uniqueReasons(unavailableReasons) }
  const partialReasons = values.flatMap((value) => value.kind === 'partial' ? value.reasons : [])
  return partialReasons.length ? { kind: 'partial', reasons: uniqueReasons(partialReasons) } : { kind: 'complete' }
}

function unavailable(message: string): Completeness {
  return { kind: 'unavailable', reasons: [{ code: 'SDK_BUILDER_CAPABILITY_MISSING', message, retryable: false }] }
}

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort()
}

function uniqueReasons<Value extends { readonly code: string; readonly message: string }>(values: readonly Value[]): Value[] {
  return [...new Map(values.map((value) => [`${value.code}\0${value.message}`, value] as const)).values()]
    .sort((left, right) => left.code.localeCompare(right.code))
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

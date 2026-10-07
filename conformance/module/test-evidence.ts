import type { Fact } from '../../analysis/index.ts'
import {
  APPLICATION_TEST_FACT_NAMESPACE,
  type ApplicationTestEvidenceFact,
} from '../../specification/observation/model.ts'
import type {
  ConformanceProfile,
  ConformanceProfileContext,
  ConformanceRuleResult,
} from '../model.ts'
import { locateDescriptorValue } from '../../specification/index.ts'
import { SPECIFICATION_VALIDITY_PROFILE_ID } from '../specification/index.ts'

export const MODULE_TEST_EVIDENCE_PROFILE_ID = 'contract.module.test-evidence'
const TEST_EVIDENCE_RULE = 'MODULE-TEST-EVIDENCE-RESOLVES'
const LAW_EVIDENCE_RULE = 'MODULE-LAW-EVIDENCE-DECLARED'

export interface ModuleTestEvidenceConformanceOptions {
  /** Require every law to carry a test reference or a code anchor. */
  readonly requireLawEvidence?: boolean
}

/**
 * Resolve authored test references and code anchors as evidence without claiming that the tests
 * passed. The law-evidence rule exists only when required, so default qualifications keep their
 * exact shape.
 */
export function createModuleTestEvidenceConformanceProfile(
  options: ModuleTestEvidenceConformanceOptions = {},
): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_TEST_EVIDENCE_PROFILE_ID,
      version: '1.0.0',
      dependsOn: [SPECIFICATION_VALIDITY_PROFILE_ID],
      requiresCapabilities: [
        {
          capability: APPLICATION_TEST_FACT_NAMESPACE,
          scope: 'specification-module',
        },
      ],
      rules: options.requireLawEvidence
        ? [TEST_EVIDENCE_RULE, LAW_EVIDENCE_RULE]
        : [TEST_EVIDENCE_RULE],
      evaluationScope: 'specification',
    },
    async evaluate(context) {
      const fact = await oneTestEvidenceFact(context)
      return [
        evidenceRule(context, fact),
        ...(options.requireLawEvidence ? [lawEvidenceRule(context)] : []),
      ]
    },
  }
}

/** A law with neither a test reference nor a code anchor is anchored to nothing observable. */
function lawEvidenceRule(context: ConformanceProfileContext): ConformanceRuleResult {
  const laws = context.specification.laws.flatMap((resource) =>
    resource.definitions.map((definition) => ({ resource, definition })),
  )
  const diagnostics = laws
    .filter(({ definition }) => !definition.tests?.length && !definition.code?.length)
    .map(({ resource, definition }) => {
      const entry = {
        code: 'LAW_EVIDENCE_REQUIRED',
        message: `Law ${definition.id} has neither a test reference nor a code anchor.`,
        file: resource.source,
        ...locateDescriptorValue(resource.source, resource.text, definition.exportName),
      }
      return {
        code: entry.code,
        severity: 'error' as const,
        message: entry.message,
        profile: MODULE_TEST_EVIDENCE_PROFILE_ID,
        rule: LAW_EVIDENCE_RULE,
        subject: context.specification.module.id,
        evidence: [],
        inputs: [],
        actual: entry,
      }
    })
  const matched = laws.length - diagnostics.length
  return {
    rule: LAW_EVIDENCE_RULE,
    status: diagnostics.length ? 'fail' : 'pass',
    diagnostics,
    coverage: {
      forward: { matched, total: laws.length },
      inverse: { matched, total: laws.length },
    },
  }
}

async function oneTestEvidenceFact(
  context: ConformanceProfileContext,
): Promise<Fact<ApplicationTestEvidenceFact>> {
  const facts: Fact<ApplicationTestEvidenceFact>[] = []
  for (const query of context.queries.values()) {
    const page = await query.facts(
      {
        namespaces: [APPLICATION_TEST_FACT_NAMESPACE],
        subjects: [context.specification.module.id],
      },
      { limit: 10 },
    )
    for (const fact of page.facts) {
      if (!isTestEvidence(fact.payload)) {
        throw new TypeError(`Test-evidence observation ${fact.id} has an invalid payload.`)
      }
      facts.push(fact as Fact<ApplicationTestEvidenceFact>)
    }
  }
  if (facts.length !== 1) {
    throw new Error(
      `Expected one test-evidence observation for ${context.specification.module.id}, found ${facts.length}.`,
    )
  }
  return facts[0]!
}

function evidenceRule(
  context: ConformanceProfileContext,
  fact: Fact<ApplicationTestEvidenceFact>,
): ConformanceRuleResult {
  const diagnostics = fact.payload.diagnostics.map((entry) => ({
    code: entry.code,
    severity: 'error' as const,
    message: entry.message,
    profile: MODULE_TEST_EVIDENCE_PROFILE_ID,
    rule: TEST_EVIDENCE_RULE,
    subject: fact.subject,
    ...(entry.pointer ? { specificationPointer: entry.pointer } : {}),
    evidence: fact.provenance.evidence,
    inputs: [fact.id],
    actual: entry,
  }))
  const references = [
    ...context.specification.laws.flatMap((resource) =>
      resource.definitions.flatMap((definition) => definition.tests ?? []),
    ),
    ...context.specification.states.flatMap((resource) =>
      resource.definitions.flatMap((definition) => definition.tests ?? []),
    ),
  ]
  const resolved = [
    ...fact.payload.laws.flatMap((definition) => definition.evidence),
    ...fact.payload.states.flatMap((definition) => definition.evidence),
  ]
  return {
    rule: TEST_EVIDENCE_RULE,
    status: diagnostics.length ? 'fail' : 'pass',
    diagnostics,
    coverage: {
      forward: { matched: resolved.length, total: references.length },
      inverse: { matched: resolved.length, total: resolved.length },
    },
  }
}

function isTestEvidence(value: unknown): value is ApplicationTestEvidenceFact {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as ApplicationTestEvidenceFact).laws) &&
      Array.isArray((value as ApplicationTestEvidenceFact).states) &&
      Array.isArray((value as ApplicationTestEvidenceFact).diagnostics),
  )
}

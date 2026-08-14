import type { Fact } from '../../analysis/index.ts'
import {
  APPLICATION_SCHEMA_FACT_NAMESPACE,
  type ApplicationSchemaCatalogFact,
} from '../../specification/observation/model.ts'
import type {
  ConformanceProfile,
  ConformanceProfileContext,
  ConformanceRuleResult,
} from '../model.ts'
import { SPECIFICATION_VALIDITY_PROFILE_ID } from '../specification/index.ts'

export const MODULE_SCHEMA_PROFILE_ID = 'contract.module.schema-catalog'
const SCHEMA_RULE = 'MODULE-SCHEMA-CATALOG-VALID'

/** Compile every schema identity and reference in one repository-local catalog. */
export function createModuleSchemaConformanceProfile(): ConformanceProfile {
  return {
    manifest: {
      id: MODULE_SCHEMA_PROFILE_ID,
      version: '1.0.0',
      dependsOn: [SPECIFICATION_VALIDITY_PROFILE_ID],
      requiresCapabilities: [
        {
          capability: APPLICATION_SCHEMA_FACT_NAMESPACE,
          scope: 'specification-module',
        },
      ],
      rules: [SCHEMA_RULE],
    },
    async evaluate(context) {
      return [schemaRule(await oneSchemaFact(context))]
    },
  }
}

async function oneSchemaFact(
  context: ConformanceProfileContext,
): Promise<Fact<ApplicationSchemaCatalogFact>> {
  const facts: Fact<ApplicationSchemaCatalogFact>[] = []
  for (const query of context.queries.values()) {
    const page = await query.facts(
      {
        namespaces: [APPLICATION_SCHEMA_FACT_NAMESPACE],
        subjects: [context.specification.module.id],
      },
      { limit: 10 },
    )
    for (const fact of page.facts) {
      if (!isSchemaFact(fact.payload)) {
        throw new TypeError(`Schema-catalog observation ${fact.id} has an invalid payload.`)
      }
      facts.push(fact as Fact<ApplicationSchemaCatalogFact>)
    }
  }
  if (facts.length !== 1) {
    throw new Error(
      `Expected one schema-catalog observation for ${context.specification.module.id}, found ${facts.length}.`,
    )
  }
  return facts[0]!
}

function schemaRule(fact: Fact<ApplicationSchemaCatalogFact>): ConformanceRuleResult {
  const diagnostics = fact.payload.diagnostics.map((entry) => ({
    code: entry.code,
    severity: 'error' as const,
    message: entry.message,
    profile: MODULE_SCHEMA_PROFILE_ID,
    rule: SCHEMA_RULE,
    subject: fact.subject,
    specificationPointer: entry.pointer,
    evidence: fact.provenance.evidence,
    inputs: [fact.id],
    actual: entry,
  }))
  const matched = diagnostics.length ? 0 : fact.payload.sources.length
  return {
    rule: SCHEMA_RULE,
    status: diagnostics.length ? 'fail' : 'pass',
    diagnostics,
    coverage: {
      forward: { matched, total: fact.payload.sources.length },
      inverse: { matched, total: fact.payload.sources.length },
    },
  }
}

function isSchemaFact(value: unknown): value is ApplicationSchemaCatalogFact {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as ApplicationSchemaCatalogFact).sources) &&
      Array.isArray((value as ApplicationSchemaCatalogFact).diagnostics),
  )
}

import type { Fact } from '../../facts/index.ts'
import type { AnalysisQuery } from '../../query/index.ts'
import {
  TYPESCRIPT_FACT_NAMESPACES,
  TypeScriptFactContractError,
  type TypeScriptFact,
  type TypeScriptFactKind,
  type TypeScriptFactReader,
} from './model.ts'
import { validateTypeScriptFactPayload } from './validate.ts'

export function createTypeScriptFactReader(query: AnalysisQuery): TypeScriptFactReader {
  return {
    async facts(kind, filter = {}, page) {
      const result = await query.facts(
        { ...filter, namespaces: [TYPESCRIPT_FACT_NAMESPACES[kind]] },
        page,
      )
      return {
        ...result,
        facts: result.facts.map((fact) => admit(kind, fact)),
      }
    },
    async factsById(kind, ids) {
      return (await query.factsById(ids)).map((fact) => admit(kind, fact))
    },
    async *export(kind, filter = {}) {
      for await (const fact of query.export({
        ...filter,
        namespaces: [TYPESCRIPT_FACT_NAMESPACES[kind]],
      })) {
        yield admit(kind, fact)
      }
    },
  }
}

function admit<Kind extends TypeScriptFactKind>(
  kind: Kind,
  fact: Fact,
): TypeScriptFact<Kind> {
  const diagnostics: string[] = []
  if (fact.namespace !== TYPESCRIPT_FACT_NAMESPACES[kind]) {
    diagnostics.push(`namespace:${fact.namespace}`)
  }
  if (fact.schemaVersion !== 1) diagnostics.push(`schema-version:${fact.schemaVersion}`)
  diagnostics.push(...validateTypeScriptFactPayload(kind, fact.payload))
  if (diagnostics.length) throw new TypeScriptFactContractError(kind, fact.id, diagnostics)
  return fact as TypeScriptFact<Kind>
}

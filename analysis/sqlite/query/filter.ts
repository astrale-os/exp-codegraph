import type { FactFilter } from '../../query/index.ts'

export interface SQLiteFilter {
  readonly sql: string
  readonly parameters: readonly string[]
}

/** Build only fixed SQL fragments; every caller value remains a bound parameter. */
export function buildSQLiteFactFilter(filter: FactFilter): SQLiteFilter {
  const clauses: string[] = []
  const parameters: string[] = []
  addValues(clauses, parameters, 'fact.fact_namespace', filter.namespaces)
  addValues(clauses, parameters, 'fact.kind', filter.kinds)
  addValues(clauses, parameters, 'fact.subject', filter.subjects)
  addValues(clauses, parameters, 'fact.completeness_kind', filter.completeness)
  addValues(clauses, parameters, 'fact.subject', filter.symbols)
  if (filter.sources) {
    if (!filter.sources.length) {
      clauses.push('0')
    } else {
      clauses.push(
        `EXISTS (
           SELECT 1
           FROM analysis_fact_evidence AS selected_evidence
           WHERE selected_evidence.store_namespace = fact.store_namespace
             AND selected_evidence.shard_digest = fact.shard_digest
             AND selected_evidence.fact_id = fact.fact_id
             AND selected_evidence.source_id IN (${placeholders(filter.sources.length)})
         )`,
      )
      parameters.push(...filter.sources)
    }
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    parameters,
  }
}

function addValues(
  clauses: string[],
  parameters: string[],
  column: string,
  values: readonly string[] | undefined,
): void {
  if (!values) return
  if (!values.length) {
    clauses.push('0')
    return
  }
  clauses.push(`${column} IN (${placeholders(values.length)})`)
  parameters.push(...values)
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

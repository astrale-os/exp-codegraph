import type { Fact } from '../../../facts/.spec/api.js'
import type { FactFilter, PageRequest, AnalysisQuery } from '../../../query/.spec/api.js'
import type {
  TypeScriptBodyFacts,
  TypeScriptDiagnosticFact,
  TypeScriptModuleFact,
  TypeScriptOccurrenceFact,
  TypeScriptProjectFact,
  TypeScriptSourceFact,
  TypeScriptSymbolFact,
} from '../../.spec/api.js'

export const TYPESCRIPT_FACT_NAMESPACES: Readonly<{
  project: 'typescript.project'
  diagnostic: 'typescript.diagnostic'
  source: 'typescript.source'
  symbol: 'typescript.symbol'
  occurrence: 'typescript.occurrence'
  body: 'typescript.body'
  module: 'astrale.typescript.module'
}>

export interface TypeScriptFactPayloadByKind {
  readonly project: TypeScriptProjectFact
  readonly diagnostic: TypeScriptDiagnosticFact
  readonly source: TypeScriptSourceFact
  readonly symbol: TypeScriptSymbolFact
  readonly occurrence: TypeScriptOccurrenceFact
  readonly body: TypeScriptBodyFacts
  readonly module: TypeScriptModuleFact
}

export type TypeScriptFactKind = keyof TypeScriptFactPayloadByKind
export type TypeScriptFact<Kind extends TypeScriptFactKind> = Fact<
  TypeScriptFactPayloadByKind[Kind]
>
export type TypeScriptFactFilter = Omit<FactFilter, 'namespaces'>

export interface TypeScriptFactPage<Kind extends TypeScriptFactKind> {
  readonly facts: readonly TypeScriptFact<Kind>[]
  readonly nextCursor?: string
  readonly total?: number
}

export interface TypeScriptFactReader {
  facts<Kind extends TypeScriptFactKind>(
    kind: Kind,
    filter?: TypeScriptFactFilter,
    page?: PageRequest,
  ): Promise<TypeScriptFactPage<Kind>>
  factsById<Kind extends TypeScriptFactKind>(
    kind: Kind,
    ids: readonly Fact['id'][],
  ): Promise<readonly TypeScriptFact<Kind>[]>
  export<Kind extends TypeScriptFactKind>(
    kind: Kind,
    filter?: TypeScriptFactFilter,
  ): AsyncIterable<TypeScriptFact<Kind>>
}

export class TypeScriptFactContractError extends Error {
  readonly code: 'TYPESCRIPT_FACT_CONTRACT_INVALID'
  readonly kind: TypeScriptFactKind
  readonly fact: string
  readonly diagnostics: readonly string[]
}

export function createTypeScriptFactReader(query: AnalysisQuery): TypeScriptFactReader

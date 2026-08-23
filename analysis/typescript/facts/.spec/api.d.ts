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
import type { ObservedDeclaration } from '../../surface/.spec/api.js'

export const TYPESCRIPT_FACT_NAMESPACES: Readonly<{
  project: 'typescript.project'
  diagnostic: 'typescript.diagnostic'
  source: 'typescript.source'
  symbol: 'typescript.symbol'
  occurrence: 'typescript.occurrence'
  body: 'typescript.body'
  module: 'astrale.typescript.module'
  declaration: 'astrale.typescript.module'
}>

/** Requestable native projectors; declaration is normalized support for module, not a capability. */
export const TYPESCRIPT_ANALYSIS_CAPABILITIES: readonly [
  'typescript.project',
  'typescript.diagnostic',
  'typescript.source',
  'typescript.symbol',
  'typescript.occurrence',
  'typescript.body',
  'astrale.typescript.module',
]

/** Canonical declaration support stored once and referenced by physical schema-v2 module facts. */
export interface TypeScriptDeclarationFact {
  readonly declaration: ObservedDeclaration
}

export interface TypeScriptModuleDeclarationReference {
  readonly fact: Fact['id']
  readonly identity: string
  readonly exportPaths: readonly (readonly string[])[]
}

/** Store-level representation; typed module reads hydrate this to TypeScriptModuleFact. */
export interface NormalizedTypeScriptModuleFact
  extends Omit<TypeScriptModuleFact, 'declarations'> {
  readonly declarations: readonly TypeScriptModuleDeclarationReference[]
}

export interface TypeScriptFactPayloadByKind {
  readonly project: TypeScriptProjectFact
  readonly diagnostic: TypeScriptDiagnosticFact
  readonly source: TypeScriptSourceFact
  readonly symbol: TypeScriptSymbolFact
  readonly occurrence: TypeScriptOccurrenceFact
  readonly body: TypeScriptBodyFacts
  readonly module: TypeScriptModuleFact
  readonly declaration: TypeScriptDeclarationFact
}

export type TypeScriptFactKind = keyof TypeScriptFactPayloadByKind
export type TypeScriptFact<Kind extends TypeScriptFactKind> = Fact<
  TypeScriptFactPayloadByKind[Kind]
> & { readonly namespace: (typeof TYPESCRIPT_FACT_NAMESPACES)[Kind] }
export type AnyTypeScriptFact = {
  readonly [Kind in Exclude<TypeScriptFactKind, 'declaration'>]: TypeScriptFact<Kind>
}[Exclude<TypeScriptFactKind, 'declaration'>]
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
  /** Validate support while yielding every logical base TypeScript fact exactly once. */
  exportAll(filter?: TypeScriptFactFilter): AsyncIterable<AnyTypeScriptFact>
}

export class TypeScriptFactContractError extends Error {
  readonly code: 'TYPESCRIPT_FACT_CONTRACT_INVALID'
  readonly kind: TypeScriptFactKind
  readonly fact: string
  readonly diagnostics: readonly string[]
}

export function createTypeScriptFactReader(query: AnalysisQuery): TypeScriptFactReader

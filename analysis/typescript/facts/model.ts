import type { Fact } from '../../facts/index.ts'
import type { FactFilter, PageRequest } from '../../query/index.ts'
import type { TypeScriptBodyFacts } from '../model.ts'
import type { ObservedDeclaration } from '../surface/index.ts'
import type {
  TypeScriptDiagnosticFact,
  TypeScriptModuleFact,
  TypeScriptOccurrenceFact,
  TypeScriptProjectFact,
  TypeScriptSourceFact,
  TypeScriptSymbolFact,
} from '../model.ts'

export const TYPESCRIPT_FACT_NAMESPACES = Object.freeze({
  project: 'typescript.project',
  diagnostic: 'typescript.diagnostic',
  source: 'typescript.source',
  symbol: 'typescript.symbol',
  occurrence: 'typescript.occurrence',
  body: 'typescript.body',
  module: 'astrale.typescript.module',
  declaration: 'astrale.typescript.module',
} as const)

/** Native projectors callers may request; declaration facts are module support, not a projector. */
export const TYPESCRIPT_ANALYSIS_CAPABILITIES = Object.freeze([
  TYPESCRIPT_FACT_NAMESPACES.project,
  TYPESCRIPT_FACT_NAMESPACES.diagnostic,
  TYPESCRIPT_FACT_NAMESPACES.source,
  TYPESCRIPT_FACT_NAMESPACES.symbol,
  TYPESCRIPT_FACT_NAMESPACES.occurrence,
  TYPESCRIPT_FACT_NAMESPACES.body,
  TYPESCRIPT_FACT_NAMESPACES.module,
] as const)

export interface TypeScriptDeclarationFact {
  readonly declaration: ObservedDeclaration
}

export interface TypeScriptModuleDeclarationReference {
  readonly fact: Fact['id']
  readonly identity: string
  readonly exportPaths: readonly (readonly string[])[]
}

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

/** Typed, validating projection over one immutable generic analysis query. */
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
  readonly code = 'TYPESCRIPT_FACT_CONTRACT_INVALID'
  readonly kind: TypeScriptFactKind
  readonly fact: string
  readonly diagnostics: readonly string[]

  constructor(kind: TypeScriptFactKind, fact: string, diagnostics: readonly string[]) {
    super(`Invalid ${kind} fact ${fact}: ${diagnostics.join(', ')}`)
    this.name = 'TypeScriptFactContractError'
    this.kind = kind
    this.fact = fact
    this.diagnostics = diagnostics
  }
}

import type { Completeness, SourceSpan } from '../../../facts/.spec/api.js'
import type { OccurrenceId, SourceId, SymbolId } from '../../../identity/.spec/api.js'
export interface TypeScriptCallSite {
  readonly call: ResolvedCall
  readonly occurrence: BodyOccurrence
  readonly callee?: OccurrenceId
  readonly path?: string
}

export interface TypeScriptCallQuery {
  /** Exact portable logical paths. Combined with sources by intersection. */
  readonly paths?: readonly string[]
  readonly sources?: readonly SourceId[]
  readonly signal?: AbortSignal
}

export interface TypeScriptCallInventory {
  readonly sites: readonly TypeScriptCallSite[]
  /** Structural call coverage, independent of bounded value/discovery proofs. */
  readonly completeness: Completeness
}


export type BodyOccurrenceKind =
  | 'statement'
  | 'expression'
  | 'declaration'
  | 'assignment'
  | 'definition'
  | 'use'
  | 'call'
  | 'return'
  | 'throw'
  | 'branch'
  | 'external-escape'

export interface BodyOccurrence {
  readonly id: OccurrenceId
  readonly kind: BodyOccurrenceKind
  readonly span: SourceSpan
  readonly owner: SymbolId
  readonly syntax: string
  readonly symbol?: SymbolId
  /** Canonical value declaration, never inferred from a compatible static type. */
  readonly symbolOrigin?: TypeScriptSymbolOrigin
  /** Actual module namespace value; never inferred from a compatible object type. */
  readonly symbolKind?: 'module-namespace'
  /** Authored name on a property-access occurrence, independent of canonical export aliases. */
  readonly propertyName?: string
  /** Static module expectation; a consumer must join it to the resolved runtime namespace. */
  readonly propertyNamespace?: SymbolId
  /** Compiler token kind for a binary operator; absent when unavailable. */
  readonly operator?: string
}

export interface TypeScriptSymbolOrigin {
  readonly package: string
  readonly file: string
  readonly path: readonly string[]
}

export interface BodyRelation {
  readonly parent: OccurrenceId
  readonly child: OccurrenceId
  readonly role: string
}

export type ControlFlowEdgeKind =
  | 'fallthrough'
  | 'true'
  | 'false'
  | 'loop'
  | 'exception'
  | 'return'

export interface ControlFlowBlock {
  readonly id: string
  readonly occurrences: readonly OccurrenceId[]
}

export interface ControlFlowEdge {
  readonly from: string
  readonly to: string
  readonly kind: ControlFlowEdgeKind
  readonly evidence?: OccurrenceId
}

export interface DefinitionUse {
  readonly definition: OccurrenceId
  readonly use: OccurrenceId
  readonly symbol?: SymbolId
  readonly reaching: 'definite' | 'possible'
}

export interface ParameterBinding {
  readonly argument: OccurrenceId
  readonly parameter?: SymbolId
  readonly index: number
  readonly rest: boolean
}

export interface ResolvedCall {
  readonly occurrence: OccurrenceId
  readonly target?: SymbolId
  /** Canonical declaration origin; absent when package/declaration identity cannot be proved. */
  readonly targetOrigin?: TypeScriptSymbolOrigin
  /** Portable identity of the selected signature declaration, not rendered or instantiated type text. */
  readonly signature?: string
  readonly receiver?: OccurrenceId
  readonly typeArguments: readonly string[]
  readonly arguments: readonly OccurrenceId[]
  readonly bindings: readonly ParameterBinding[]
  readonly callbacks: readonly SymbolId[]
  readonly dynamic: boolean
}

export interface FunctionSummary {
  readonly function: SymbolId
  readonly returns: readonly OccurrenceId[]
  readonly throws: readonly OccurrenceId[]
  readonly captures: readonly SymbolId[]
  readonly calls: readonly OccurrenceId[]
  readonly escapes: readonly OccurrenceId[]
  readonly recursion: boolean
}

export interface FunctionBodyIR {
  /** Lexical execution owner. Older body facts omit this and describe a function. */
  readonly scope?: 'function' | 'module'
  /** Function execution form; absence in older facts does not prove synchronous execution. */
  readonly execution?: 'sync' | 'async' | 'generator' | 'async-generator'
  /** Stable owner identity, also used for a module's evaluation scope. */
  readonly function: SymbolId
  readonly parameters: readonly SymbolId[]
  readonly occurrences: readonly BodyOccurrence[]
  readonly relations: readonly BodyRelation[]
  readonly blocks: readonly ControlFlowBlock[]
  readonly edges: readonly ControlFlowEdge[]
  readonly definitions: readonly DefinitionUse[]
  readonly calls: readonly ResolvedCall[]
  readonly summary: FunctionSummary
}

export function validateFunctionBodyIR(body: FunctionBodyIR): readonly string[]

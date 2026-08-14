import type { SourceSpan } from '../../../facts/.spec/api.js'
import type { OccurrenceId, SymbolId } from '../../../identity/.spec/api.js'

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

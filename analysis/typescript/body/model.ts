import type { SourceSpan } from '../../facts/index.ts'
import type { OccurrenceId, SymbolId } from '../../identity/index.ts'

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

export function validateFunctionBodyIR(body: FunctionBodyIR): readonly string[] {
  const diagnostics: string[] = []
  const occurrences = new Set(body.occurrences.map((occurrence) => occurrence.id))
  if (occurrences.size !== body.occurrences.length) diagnostics.push('BODY_OCCURRENCE_DUPLICATE')
  const blocks = new Set(body.blocks.map((block) => block.id))
  const occurrenceBlocks = new Map<OccurrenceId, number>()
  if (blocks.size !== body.blocks.length) diagnostics.push('BODY_BLOCK_DUPLICATE')
  for (const block of body.blocks) {
    for (const occurrence of block.occurrences) {
      if (!occurrences.has(occurrence)) diagnostics.push(`BODY_BLOCK_OCCURRENCE_UNKNOWN:${occurrence}`)
      occurrenceBlocks.set(occurrence, (occurrenceBlocks.get(occurrence) ?? 0) + 1)
    }
  }
  for (const occurrence of occurrences) {
    const count = occurrenceBlocks.get(occurrence) ?? 0
    if (count === 0) diagnostics.push(`BODY_OCCURRENCE_UNASSIGNED:${occurrence}`)
    if (count > 1) diagnostics.push(`BODY_OCCURRENCE_MULTIPLE_BLOCKS:${occurrence}`)
  }
  const relations = new Set<string>()
  for (const relation of body.relations) {
    if (!occurrences.has(relation.parent) || !occurrences.has(relation.child)) {
      diagnostics.push('BODY_RELATION_OCCURRENCE_UNKNOWN')
    }
    if (!relation.role) diagnostics.push('BODY_RELATION_ROLE_REQUIRED')
    const key = `${relation.parent}\0${relation.child}\0${relation.role}`
    if (relations.has(key)) diagnostics.push('BODY_RELATION_DUPLICATE')
    relations.add(key)
  }
  for (const edge of body.edges) {
    if (!blocks.has(edge.from) || !blocks.has(edge.to)) diagnostics.push('BODY_EDGE_BLOCK_UNKNOWN')
    if (edge.evidence && !occurrences.has(edge.evidence)) diagnostics.push('BODY_EDGE_EVIDENCE_UNKNOWN')
  }
  for (const relation of body.definitions) {
    if (!occurrences.has(relation.definition) || !occurrences.has(relation.use)) {
      diagnostics.push('BODY_DEFINITION_USE_UNKNOWN')
    }
  }
  for (const call of body.calls) {
    if (!occurrences.has(call.occurrence)) diagnostics.push('BODY_CALL_OCCURRENCE_UNKNOWN')
    for (const argument of call.arguments) {
      if (!occurrences.has(argument)) diagnostics.push('BODY_CALL_ARGUMENT_UNKNOWN')
    }
  }
  return [...new Set(diagnostics)].sort()
}

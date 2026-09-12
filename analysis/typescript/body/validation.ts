import type { OccurrenceId } from '../../identity/index.ts'
import type {
  BodyOccurrence, BodyOccurrenceKind, ControlFlowEdgeKind, FunctionBodyIR, TypeScriptSymbolOrigin,
} from './model.ts'

/** Private semantic view. Structural decoding must complete before this validator runs. */
export interface BodyValidationView extends Omit<FunctionBodyIR,
  'occurrences' | 'blocks' | 'relations' | 'edges' | 'definitions' | 'calls'> {
  readonly occurrences: Iterable<BodyOccurrence> & { readonly length: number }
  readonly blocks: Iterable<{ readonly id: string; readonly occurrences: Iterable<OccurrenceId> }> & { readonly length: number }
  readonly relations: Iterable<FunctionBodyIR['relations'][number]>
  readonly edges: Iterable<FunctionBodyIR['edges'][number]>
  readonly definitions: Iterable<FunctionBodyIR['definitions'][number]>
  readonly calls: Iterable<Omit<FunctionBodyIR['calls'][number], 'callbacks' | 'signature' | 'arguments' | 'bindings'> & {
    readonly arguments: Iterable<OccurrenceId>
    readonly bindings: Iterable<FunctionBodyIR['calls'][number]['bindings'][number]>
  }>
}

/** Already-normalized IDs avoid materializing rows solely to construct identity sets. */
export interface BodyValidationIdentities {
  readonly occurrences: readonly OccurrenceId[]
  readonly blocks: readonly string[]
}

const BODY_OCCURRENCE_KINDS = new Set<BodyOccurrenceKind>([
  'statement',
  'expression',
  'declaration',
  'assignment',
  'definition',
  'use',
  'call',
  'return',
  'throw',
  'branch',
  'external-escape',
])
const CONTROL_FLOW_EDGE_KINDS = new Set<ControlFlowEdgeKind>([
  'fallthrough',
  'true',
  'false',
  'loop',
  'exception',
  'return',
])

export function validateBodyView(body: BodyValidationView, identities?: BodyValidationIdentities): readonly string[] {
  const diagnostics: string[] = []
  if (!body.function) diagnostics.push('BODY_FUNCTION_REQUIRED')
  if (body.scope !== undefined && body.scope !== 'function' && body.scope !== 'module') {
    diagnostics.push('BODY_SCOPE_INVALID')
  }
  if (body.execution !== undefined && !['sync', 'async', 'generator', 'async-generator'].includes(body.execution)) {
    diagnostics.push('BODY_EXECUTION_INVALID')
  }
  if (body.scope === 'module' && body.execution !== undefined) diagnostics.push('BODY_MODULE_EXECUTION_INVALID')
  if (body.scope === 'module' && (body.parameters.length || body.summary.returns.length || body.summary.recursion)) {
    diagnostics.push('BODY_MODULE_FUNCTION_STATE')
  }
  const occurrences = new Set(identities?.occurrences ?? (body.occurrences as FunctionBodyIR['occurrences']).map((occurrence) => occurrence.id))
  if (occurrences.size !== body.occurrences.length) diagnostics.push('BODY_OCCURRENCE_DUPLICATE')
  for (const occurrence of body.occurrences) {
    if (!occurrence.id) diagnostics.push('BODY_OCCURRENCE_ID_REQUIRED')
    if (!BODY_OCCURRENCE_KINDS.has(occurrence.kind)) diagnostics.push('BODY_OCCURRENCE_KIND_INVALID')
    if (occurrence.owner !== body.function) diagnostics.push('BODY_OCCURRENCE_OWNER_MISMATCH')
    if (!occurrence.syntax) diagnostics.push('BODY_OCCURRENCE_SYNTAX_REQUIRED')
    if (occurrence.propertyNamespace !== undefined && (occurrence.syntax !== 'PropertyAccessExpression' || typeof occurrence.propertyNamespace !== 'string' || !occurrence.propertyNamespace)) diagnostics.push('BODY_PROPERTY_NAMESPACE_INVALID')
    if (occurrence.propertyName !== undefined && (!['PropertyAccessExpression', 'ShorthandPropertyAssignment'].includes(occurrence.syntax) || typeof occurrence.propertyName !== 'string' || !occurrence.propertyName)) diagnostics.push('BODY_PROPERTY_NAME_INVALID')
    if (occurrence.symbolKind !== undefined && (!occurrence.symbol || occurrence.symbolKind !== 'module-namespace')) diagnostics.push('BODY_SYMBOL_KIND_INVALID')
    if (occurrence.operator !== undefined && (typeof occurrence.operator !== 'string' || !occurrence.operator))
      diagnostics.push('BODY_OCCURRENCE_OPERATOR_INVALID')
    if (occurrence.symbolOrigin !== undefined && (!occurrence.symbol || !validSymbolOrigin(occurrence.symbolOrigin))) {
      diagnostics.push('BODY_OCCURRENCE_SYMBOL_ORIGIN_INVALID')
    }
    if (
      !occurrence.span.source ||
      !occurrence.span.revision ||
      !Number.isSafeInteger(occurrence.span.start) ||
      !Number.isSafeInteger(occurrence.span.end) ||
      occurrence.span.start < 0 ||
      occurrence.span.end <= occurrence.span.start
    ) diagnostics.push('BODY_OCCURRENCE_SPAN_INVALID')
  }
  const blocks = new Set(identities?.blocks ?? (body.blocks as FunctionBodyIR['blocks']).map((block) => block.id))
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
    if (!CONTROL_FLOW_EDGE_KINDS.has(edge.kind)) diagnostics.push('BODY_EDGE_KIND_INVALID')
    if (edge.evidence && !occurrences.has(edge.evidence)) diagnostics.push('BODY_EDGE_EVIDENCE_UNKNOWN')
  }
  for (const relation of body.definitions) {
    if (!occurrences.has(relation.definition) || !occurrences.has(relation.use)) {
      diagnostics.push('BODY_DEFINITION_USE_UNKNOWN')
    }
    if (relation.reaching !== 'definite' && relation.reaching !== 'possible') {
      diagnostics.push('BODY_DEFINITION_REACHING_INVALID')
    }
  }
  for (const call of body.calls) {
    if (call.targetOrigin !== undefined && (!call.target || !validSymbolOrigin(call.targetOrigin))) {
      diagnostics.push('BODY_CALL_TARGET_ORIGIN_INVALID')
    }
    if (!occurrences.has(call.occurrence)) diagnostics.push('BODY_CALL_OCCURRENCE_UNKNOWN')
    if (call.receiver && !occurrences.has(call.receiver)) diagnostics.push('BODY_CALL_RECEIVER_UNKNOWN')
    for (const argument of call.arguments) {
      if (!occurrences.has(argument)) diagnostics.push('BODY_CALL_ARGUMENT_UNKNOWN')
    }
    for (const binding of call.bindings) {
      if (!occurrences.has(binding.argument)) diagnostics.push('BODY_BINDING_ARGUMENT_UNKNOWN')
      if (!Number.isSafeInteger(binding.index) || binding.index < 0) {
        diagnostics.push('BODY_BINDING_INDEX_INVALID')
      }
      if (typeof binding.rest !== 'boolean') diagnostics.push('BODY_BINDING_REST_INVALID')
    }
    if (typeof call.dynamic !== 'boolean') diagnostics.push('BODY_CALL_DYNAMIC_INVALID')
    if (call.typeArguments.some((argument) => !argument)) diagnostics.push('BODY_CALL_TYPE_INVALID')
  }
  if (body.summary.function !== body.function) diagnostics.push('BODY_SUMMARY_FUNCTION_MISMATCH')
  for (const [name, values] of [
    ['RETURN', body.summary.returns],
    ['THROW', body.summary.throws],
    ['CALL', body.summary.calls],
    ['ESCAPE', body.summary.escapes],
  ] as const) {
    if (values.some((occurrence) => !occurrences.has(occurrence))) {
      diagnostics.push(`BODY_SUMMARY_${name}_UNKNOWN`)
    }
  }
  if (typeof body.summary.recursion !== 'boolean') diagnostics.push('BODY_SUMMARY_RECURSION_INVALID')
  return [...new Set(diagnostics)].sort()
}

function validSymbolOrigin(origin: TypeScriptSymbolOrigin): boolean {
  return Boolean(origin && typeof origin.package === 'string' && origin.package &&
    typeof origin.file === 'string' && origin.file && Array.isArray(origin.path) &&
    origin.path.length && origin.path.every((part) => typeof part === 'string' && part))
}

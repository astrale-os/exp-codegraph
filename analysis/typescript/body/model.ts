import { validateBodyView } from './validation.ts'
import type { FunctionBodyIR } from './types.ts'

export type {
  TypeScriptCallSite, TypeScriptCallQuery, TypeScriptCallInventory, BodyOccurrenceKind, BodyOccurrence,
  TypeScriptSymbolOrigin, BodyRelation, ControlFlowEdgeKind, ControlFlowBlock, ControlFlowEdge,
  DefinitionUse, ParameterBinding, ResolvedCall, FunctionSummary, FunctionBodyIR,
} from './types.ts'

/** Validate a logical body with the same semantic authority used by compact admission. */
export function validateFunctionBodyIR(body: FunctionBodyIR): readonly string[] {
  return validateBodyView(body)
}

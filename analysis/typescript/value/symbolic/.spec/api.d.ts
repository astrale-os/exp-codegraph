import type { SymbolId } from '../../../../identity/.spec/api.js'
import type { BodyOccurrence, FunctionBodyIR, ResolvedCall } from '../../../body/.spec/api.js'
import type { BoundedValueLimits, EvaluatedValueResult, ValueResult } from '../../.spec/api.js'

/** Inspectable shape. Closures, argument environments and object references remain private. */
export type SymbolicValue<Atom = never> =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'object'; readonly properties: readonly string[]; readonly complete: boolean }
  | { readonly kind: 'function'; readonly symbol: SymbolId; readonly execution: FunctionBodyIR['execution']; readonly parameterCount: number }
  | { readonly kind: 'external'; readonly symbol: SymbolId; readonly symbolOrigin?: BodyOccurrence['symbolOrigin'] }
  | { readonly kind: 'atom'; readonly value: Atom }

export interface SymbolicCallContext<Atom> {
  readonly call: ResolvedCall
  /**
   * Property named by the callee IR, distinct from the resolved declaration's name.
   * Absent for calls without a proved property name. The first read uses the current
   * proof budget and dependencies; reads are valid only during this call model.
   */
  readonly propertyName?: string
  /** Demand operands only when the model needs them; all reads use the current proof budget. */
  callee(): SymbolicOperandPlan<Atom>
  receiver(): SymbolicOperandPlan<Atom> | undefined
  argument(index: number): SymbolicOperandPlan<Atom> | undefined
}

/** Lazy operand in the current proof; resolve only during its synchronous call model. */
export interface SymbolicOperandPlan<Atom = never> {
  property(name: string): SymbolicOperandPlan<Atom>
  invoke(): SymbolicOperandPlan<Atom>
  resolve(): ValueResult<SymbolicValue<Atom>>
}

/** Undefined delegates ordinary calls; returning an operand preserves its symbolic value. */
export type SymbolicCallModel<Atom> = (context: SymbolicCallContext<Atom>) =>
  | { readonly kind: 'atom'; readonly value: Atom }
  | { readonly kind: 'unknown'; readonly reason: string }
  | SymbolicOperandPlan<Atom>
  | undefined

export interface SymbolicValueResolveOptions {
  readonly signal?: AbortSignal
  readonly limits?: BoundedValueLimits
}

/** Immutable demand plan: each resolve gets its own budget and evidence. */
export interface SymbolicValuePlan<Atom = never> {
  property(name: string): SymbolicValuePlan<Atom>
  invoke(): SymbolicValuePlan<Atom>
  resolve(options?: SymbolicValueResolveOptions): Promise<EvaluatedValueResult<SymbolicValue<Atom>>>
}

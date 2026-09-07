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
  /** Demand operands only when the model needs them; all reads use the current proof budget. */
  callee(): ValueResult<SymbolicValue<Atom>>
  receiver(): ValueResult<SymbolicValue<Atom>> | undefined
  argument(index: number): ValueResult<SymbolicValue<Atom>> | undefined
}

/** Undefined delegates ordinary TypeScript calls to the generic evaluator. */
export type SymbolicCallModel<Atom> = (context: SymbolicCallContext<Atom>) =>
  | { readonly kind: 'atom'; readonly value: Atom }
  | { readonly kind: 'unknown'; readonly reason: string }
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

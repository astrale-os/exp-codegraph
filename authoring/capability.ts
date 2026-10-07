import type { SemanticReference } from './reference.ts'

export interface CapabilityDefinition<Id extends string = string> {
  readonly id: Id
  readonly statement: string
  /** Optional laws, declared here or by a descendant module, that realize this capability. */
  readonly laws?: readonly SemanticReference[]
  /** Optional capabilities, declared here or by a descendant module, that compose this one. */
  readonly capabilities?: readonly SemanticReference[]
}

/** Preserve one shallow, statically extractable capability declaration. */
export function defineCapability<const Definition extends CapabilityDefinition>(
  definition: Definition,
): Definition {
  return definition
}

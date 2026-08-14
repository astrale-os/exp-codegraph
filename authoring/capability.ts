export interface CapabilityDefinition<Id extends string = string> {
  readonly id: Id
  readonly statement: string
}

/** Preserve one shallow, statically extractable capability declaration. */
export function defineCapability<const Definition extends CapabilityDefinition>(
  definition: Definition,
): Definition {
  return definition
}

/** The module-root-relative paths governed by one physical layout declaration. */
export type LayoutEntries = readonly string[]

/** Optional observation policy around one physical layout. */
export interface LayoutConfiguration<Entries extends LayoutEntries = LayoutEntries> {
  readonly entries: Entries
  /** Reject every non-ignored module path missing from `entries`. Sparse by default. */
  readonly exact?: boolean
  /** Module-relative glob patterns omitted from observation unless explicitly declared. */
  readonly ignore?: readonly string[]
}

export type LayoutDefinition = LayoutEntries | LayoutConfiguration

/** Preserve one authoritative physical layout without executing it. */
export function defineLayout<const Definition extends LayoutDefinition>(
  definition: Definition,
): Definition {
  return definition
}

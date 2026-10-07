/**
 * Stable reference to one semantic identifier.
 *
 * A string names an identifier declared by the citing module. The object form names an identifier
 * declared by a strict descendant module, addressed by its POSIX path relative to the citing
 * module root.
 */
export type SemanticReference = string | { readonly module: string; readonly id: string }

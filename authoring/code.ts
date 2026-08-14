/** Additional private implementation entrypoints governed by one module specification. */
export interface CodeConfiguration<Internals extends readonly string[] = readonly string[]> {
  readonly internals: Internals
}

/** Preserve a closed list of deliberate shared implementation entrypoints. */
export function defineCode<const Configuration extends CodeConfiguration>(
  configuration: Configuration,
): Configuration {
  return configuration
}

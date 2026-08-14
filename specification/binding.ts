/** TypeScript implementation boundary observed for one specified module. */
export interface ImplementationBinding {
  readonly project: string
  readonly root: string
  readonly entrypoint: string
  /** Public entrypoints exposing only declarations from the canonical entrypoint. */
  readonly facades?: readonly string[]
  readonly aliases?: readonly string[]
  /** Explicit implementation entrypoints that carry no public API contract. */
  readonly internals?: readonly string[]
}

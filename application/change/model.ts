import type { SpecificationSnapshot } from '../../specification/index.ts'

/** The portable identity used by the application to name one specification owner. */
export type SpecificationOwner = SpecificationSnapshot['source']

/** A file-system event kind that can affect the impact index. */
export type SpecificationChangeKind = 'change' | 'add' | 'delete' | 'unlink'

/**
 * Optional information about the change being classified.
 *
 * `operation` and `topologyAmbiguous` are accepted as explicit spellings for callers that
 * already use those terms. `kind` is the canonical form.
 */
export interface SpecificationChangeOptions {
  readonly kind?: SpecificationChangeKind
  /** Force a full result when the caller cannot prove repository topology. */
  readonly topologyAmbiguous?: boolean
}

export type SpecificationImpactCompleteness = 'exact' | 'conservative-full'

/** Stable reason codes explaining why the full corpus was selected. */
export type SpecificationImpactFallbackReason =
  | 'unknown-declaration'
  | 'package-configuration'
  | 'typescript-configuration'
  | 'topology-ambiguity'

export interface SpecificationImpact {
  /** The validated, root-relative POSIX path supplied to the query. */
  readonly path: string
  /** Owners whose indexed normative inputs contain `path`. */
  readonly directOwners: readonly SpecificationOwner[]
  /** Owners reached through reverse source/declaration dependency edges. */
  readonly dependentOwners: readonly SpecificationOwner[]
  /** Owners that must be refreshed for this change classification. */
  readonly refreshedOwners: readonly SpecificationOwner[]
  readonly completeness: SpecificationImpactCompleteness
  readonly fallbackReasons: readonly SpecificationImpactFallbackReason[]
}

export interface SpecificationImpactIndex {
  /** Every owner represented by the indexed corpus, in stable order. */
  readonly owners: readonly SpecificationOwner[]
  /** Every indexed path, including unresolved reference targets, in stable order. */
  readonly paths: readonly string[]
  impact(path: string, options?: SpecificationChangeOptions): SpecificationImpact
  /** Alias useful at call sites that describe the operation as a lookup. */
  lookup(path: string, options?: SpecificationChangeOptions): SpecificationImpact
  /** Alias useful at call sites that describe the operation as resolution. */
  resolve(path: string, options?: SpecificationChangeOptions): SpecificationImpact
}

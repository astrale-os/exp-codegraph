import type { SpecificationSnapshot } from '../../../specification/.spec/api.js'

export type SpecificationOwner = SpecificationSnapshot['source']
export type SpecificationChangeKind = 'change' | 'add' | 'delete' | 'unlink'
export type SpecificationImpactCompleteness = 'exact' | 'conservative-full'
export type SpecificationImpactFallbackReason =
  | 'unknown-declaration'
  | 'package-configuration'
  | 'typescript-configuration'
  | 'topology-ambiguity'

export interface SpecificationChangeOptions {
  readonly kind?: SpecificationChangeKind
  readonly topologyAmbiguous?: boolean
}

export interface SpecificationImpact {
  readonly path: string
  readonly directOwners: readonly SpecificationOwner[]
  readonly dependentOwners: readonly SpecificationOwner[]
  readonly refreshedOwners: readonly SpecificationOwner[]
  readonly completeness: SpecificationImpactCompleteness
  readonly fallbackReasons: readonly SpecificationImpactFallbackReason[]
}

export interface SpecificationImpactIndex {
  readonly owners: readonly SpecificationOwner[]
  readonly paths: readonly string[]
  impact(path: string, options?: SpecificationChangeOptions): SpecificationImpact
  lookup(path: string, options?: SpecificationChangeOptions): SpecificationImpact
  resolve(path: string, options?: SpecificationChangeOptions): SpecificationImpact
}

export function createSpecificationImpactIndex(
  specifications: readonly SpecificationSnapshot[],
): SpecificationImpactIndex
export function computeSpecificationImpact(
  specifications: readonly SpecificationSnapshot[],
  path: string,
  options?: SpecificationChangeOptions,
): SpecificationImpact
export function findSpecificationImpact(
  index: SpecificationImpactIndex | readonly SpecificationSnapshot[],
  path: string,
  options?: SpecificationChangeOptions,
): SpecificationImpact
export function assertCanonicalRepositoryPath(path: string): string

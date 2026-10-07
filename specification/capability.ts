import type { SemanticReference } from '../authoring/reference.ts'
import type { CapabilityResource } from './resource/index.ts'

export type CapabilityStatus = 'declared' | 'partial' | 'held'

/** One semantic identifier addressed by its catalog-relative module root. */
export interface CapabilityCoordinate {
  readonly module: string
  readonly id: string
}

export interface CapabilityDerivationModule {
  /** Catalog-relative POSIX module root; `.` names the catalog root. */
  readonly root: string
  readonly capabilities: readonly CapabilityResource[]
  /** Declared laws, each with whether at least one active test declaration is attached. */
  readonly laws: readonly { readonly id: string; readonly active: boolean }[]
}

export interface DerivedCapability extends CapabilityCoordinate {
  readonly source: string
  readonly status: CapabilityStatus
  /** Cited laws without an active test and cited capabilities that are not held. */
  readonly blocking: {
    readonly laws: readonly CapabilityCoordinate[]
    readonly capabilities: readonly CapabilityCoordinate[]
  }
}

/** Whether an authored module coordinate can only name a strict descendant of its citing module. */
export function isDescendantModulePath(value: string): boolean {
  if (!value || value.includes('\\') || value.includes('\0')) return false
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return false
  return value
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** Catalog-relative root of the descendant module cited from one module root. */
export function descendantModuleRoot(root: string, module: string): string {
  return root === '.' ? module : `${root}/${module}`
}

/** Stable identity of one authored reference inside its citing module. */
export function semanticReferenceKey(reference: SemanticReference): string {
  return typeof reference === 'string' ? `\0${reference}` : `${reference.module}\0${reference.id}`
}

/** Public-contract anchors of every descendant module cited by one module's capabilities. */
export function capabilityReferenceSources(specification: {
  readonly root: string
  readonly capabilities: readonly CapabilityResource[]
}): readonly string[] {
  const sources = new Set<string>()
  for (const resource of specification.capabilities) {
    for (const definition of resource.definitions) {
      for (const reference of [...(definition.laws ?? []), ...(definition.capabilities ?? [])]) {
        if (typeof reference === 'string' || !isDescendantModulePath(reference.module)) continue
        sources.add(
          `${descendantModuleRoot(specification.root, reference.module)}/.spec/api.d.ts`,
        )
      }
    }
  }
  return [...sources].sort(compare)
}

/**
 * Derive every capability status from authored citations and attached active tests.
 *
 * A capability that cites nothing is declared. It is held when every cited law has an active
 * attached test and every cited capability is held; anything else, including an unresolved
 * citation or a citation cycle, is partial. The status is reported and is never a diagnostic.
 */
export function deriveCapabilityStatuses(
  modules: readonly CapabilityDerivationModule[],
): readonly DerivedCapability[] {
  const ordered = [...modules].sort((left, right) => compare(left.root, right.root))
  const activeLaws = new Map<string, boolean>()
  const capabilities = new Map<string, DerivationEntry>()
  const entries: DerivationEntry[] = []
  for (const module of ordered) {
    for (const law of module.laws) {
      const key = coordinateKey({ module: module.root, id: law.id })
      activeLaws.set(key, law.active || activeLaws.get(key) === true)
    }
    for (const resource of module.capabilities) {
      for (const definition of resource.definitions) {
        const entry: DerivationEntry = {
          module: module.root,
          id: definition.id,
          source: resource.source,
          laws: (definition.laws ?? []).map((reference) => coordinate(module.root, reference)),
          capabilities: (definition.capabilities ?? []).map((reference) =>
            coordinate(module.root, reference),
          ),
        }
        entries.push(entry)
        const key = coordinateKey(entry)
        if (!capabilities.has(key)) capabilities.set(key, entry)
      }
    }
  }

  const derived = new Map<DerivationEntry, DerivedCapability>()
  const visiting = new Set<DerivationEntry>()
  const derive = (entry: DerivationEntry): DerivedCapability => {
    const known = derived.get(entry)
    if (known) return known
    visiting.add(entry)
    const blockingLaws = entry.laws.filter((law) => activeLaws.get(coordinateKey(law)) !== true)
    const blockingCapabilities = entry.capabilities.filter((cited) => {
      const target = capabilities.get(coordinateKey(cited))
      // A capability reached again while it is being derived closes a citation cycle.
      if (!target || visiting.has(target)) return true
      return derive(target).status !== 'held'
    })
    visiting.delete(entry)
    const result: DerivedCapability = {
      module: entry.module,
      id: entry.id,
      source: entry.source,
      status:
        entry.laws.length + entry.capabilities.length === 0
          ? 'declared'
          : blockingLaws.length + blockingCapabilities.length === 0
            ? 'held'
            : 'partial',
      blocking: { laws: blockingLaws, capabilities: blockingCapabilities },
    }
    derived.set(entry, result)
    return result
  }
  return entries.map(derive)
}

interface DerivationEntry extends CapabilityCoordinate {
  readonly source: string
  readonly laws: readonly CapabilityCoordinate[]
  readonly capabilities: readonly CapabilityCoordinate[]
}

function coordinate(root: string, reference: SemanticReference): CapabilityCoordinate {
  return typeof reference === 'string'
    ? { module: root, id: reference }
    : { module: descendantModuleRoot(root, reference.module), id: reference.id }
}

function coordinateKey(value: CapabilityCoordinate): string {
  return `${value.module}\0${value.id}`
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

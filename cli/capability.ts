import type { TypeSpecApplicationReader } from '../application/index.ts'
import type {
  CapabilityCoordinate,
  CapabilityStatus,
  DerivedCapability,
} from '../specification/index.ts'

import {
  APPLICATION_TEST_FACT_NAMESPACE,
  type ApplicationTestEvidenceFact,
} from '../application/observation/index.ts'
import { deriveCapabilityStatuses } from '../specification/index.ts'

export interface CliCapabilityStatus extends CapabilityCoordinate {
  readonly source: string
  readonly status: CapabilityStatus
  /** Present only when partial: what keeps the capability from being held. */
  readonly blocking?: DerivedCapability['blocking']
}

export interface CliCapabilityReport {
  readonly declared: number
  readonly partial: number
  readonly held: number
  readonly entries: readonly CliCapabilityStatus[]
}

/** Derive the status of every checked capability from citations and attached active tests. */
export async function capabilityReport(
  reader: TypeSpecApplicationReader,
): Promise<CliCapabilityReport> {
  const snapshot = reader.snapshot
  const citing = snapshot.specifications.some((specification) =>
    specification.capabilities.some((resource) =>
      resource.definitions.some(
        (definition) => definition.laws?.length || definition.capabilities?.length,
      ),
    ),
  )
  // Without a citation every capability is declared; attached evidence cannot change that.
  const active = citing ? await activeLaws(reader) : new Map<string, ReadonlySet<string>>()
  const entries = deriveCapabilityStatuses(
    snapshot.specifications.map((specification) => ({
      root: specification.root,
      capabilities: specification.capabilities,
      laws: specification.laws.flatMap((resource) =>
        resource.definitions.map((definition) => ({
          id: definition.id,
          active: active.get(specification.module.id)?.has(definition.id) === true,
        })),
      ),
    })),
  ).map(
    ({ blocking, ...entry }): CliCapabilityStatus =>
      entry.status === 'partial' ? { ...entry, blocking } : entry,
  )
  const count = (status: CapabilityStatus) =>
    entries.filter((entry) => entry.status === status).length
  return {
    declared: count('declared'),
    partial: count('partial'),
    held: count('held'),
    entries,
  }
}

/** One stable line; a scope without capabilities stays silent. */
export function capabilitySummary(report: CliCapabilityReport): string | undefined {
  if (!report.entries.length) return
  return `Capabilities: ${report.declared} declared, ${report.partial} partial, ${report.held} held.`
}

async function activeLaws(
  reader: TypeSpecApplicationReader,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const active = new Map<string, Set<string>>()
  for (const universe of reader.snapshot.analysis?.universes ?? []) {
    const query = await reader.query(universe)
    try {
      for await (const fact of query.export({ namespaces: [APPLICATION_TEST_FACT_NAMESPACE] })) {
        const laws = active.get(fact.subject) ?? new Set<string>()
        for (const law of (fact.payload as ApplicationTestEvidenceFact).laws) {
          if (law.evidence.some((evidence) => evidence.status === 'active')) laws.add(law.id)
        }
        active.set(fact.subject, laws)
      }
    } finally {
      await query.dispose()
    }
  }
  return active
}

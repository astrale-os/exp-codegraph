import type { ConformanceProfile, QualificationScope } from './model.ts'

export interface ConformancePlan {
  readonly ordered: readonly ConformanceProfile[]
  readonly scope: QualificationScope
}

export function planConformance(
  profiles: readonly ConformanceProfile[],
  requestedProfiles?: readonly string[],
): ConformancePlan {
  const byId = new Map<string, ConformanceProfile>()
  for (const profile of profiles) {
    const manifest = profile.manifest
    if (!manifest.id || !manifest.version || !manifest.rules.length) {
      throw new Error('A conformance profile has an invalid manifest.')
    }
    if (byId.has(manifest.id)) {
      throw new Error(`Conformance profile ${manifest.id} is installed more than once.`)
    }
    if (new Set(manifest.rules).size !== manifest.rules.length) {
      throw new Error(`Conformance profile ${manifest.id} declares duplicate rules.`)
    }
    for (const requirement of manifest.requiresCapabilities) {
      const accepted = requirement.acceptedPartialReasonCodes
      if (
        !requirement.capability ||
        (accepted !== undefined &&
          ((requirement.minimumCompleteness ?? 'complete') !== 'partial' ||
            !accepted.length ||
            new Set(accepted).size !== accepted.length))
      ) {
        throw new Error(
          `Conformance profile ${manifest.id} declares an invalid capability requirement.`,
        )
      }
    }
    byId.set(manifest.id, profile)
  }

  const requested = requestedProfiles
    ? [...new Set(requestedProfiles)].sort(compare)
    : [...byId.keys()].sort(compare)
  for (const id of requested) {
    if (!byId.has(id)) throw new Error(`Requested conformance profile ${id} is not installed.`)
  }

  const included = new Set<string>()
  const visiting = new Set<string>()
  const ordered: ConformanceProfile[] = []
  const visit = (id: string): void => {
    if (included.has(id)) return
    if (visiting.has(id)) throw new Error(`Conformance profile dependency cycle includes ${id}.`)
    const profile = byId.get(id)
    if (!profile) throw new Error(`Conformance profile dependency ${id} is not installed.`)
    visiting.add(id)
    for (const dependency of [...profile.manifest.dependsOn].sort(compare)) visit(dependency)
    visiting.delete(id)
    included.add(id)
    ordered.push(profile)
  }
  for (const id of requested) visit(id)

  const includedProfiles = ordered.map((profile) => profile.manifest.id)
  return {
    ordered,
    scope: requestedProfiles
      ? {
          kind: 'focused',
          authority: 'advisory',
          requestedProfiles: requested,
          includedProfiles,
          supportProfiles: includedProfiles.filter((id) => !requested.includes(id)),
        }
      : { kind: 'full', authority: 'full-ci' },
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

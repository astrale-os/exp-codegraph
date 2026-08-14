export interface HistoricalQualificationEvidence {
  readonly catalog: { readonly entries: readonly { readonly source: string }[] }
  readonly qualification: {
    readonly specifications: readonly {
      readonly source: string
      readonly status: string
      readonly profiles: readonly unknown[]
    }[]
  }
}

export interface HistoricalEvidenceProjection {
  readonly evidence: HistoricalQualificationEvidence
  readonly retainedSources: readonly string[]
  readonly excludedSources: readonly string[]
  readonly absentSources: readonly string[]
}

/** Project immutable historical evidence onto an explicitly supplied current authority set. */
export function projectHistoricalQualificationEvidence(
  evidence: HistoricalQualificationEvidence,
  authoritySources: readonly string[],
): HistoricalEvidenceProjection {
  const authority = new Set(authoritySources)
  const available = new Set([
    ...evidence.catalog.entries.map((entry) => entry.source),
    ...evidence.qualification.specifications.map((entry) => entry.source),
  ])
  const retainedSources = [...available].filter((source) => authority.has(source)).sort(compare)
  const excludedSources = [...available].filter((source) => !authority.has(source)).sort(compare)
  const absentSources = [...authority].filter((source) => !available.has(source)).sort(compare)
  return {
    evidence: {
      catalog: {
        entries: evidence.catalog.entries.filter((entry) => authority.has(entry.source)),
      },
      qualification: {
        specifications: evidence.qualification.specifications.filter((entry) =>
          authority.has(entry.source),
        ),
      },
    },
    retainedSources,
    excludedSources,
    absentSources,
  }
}

export interface HistoricalQualificationDifference {
  readonly source: string
  readonly field: string
  readonly historical: unknown
  readonly candidate: unknown
}

export interface HistoricalDifferenceGovernance {
  readonly status: 'accepted' | 'unexplained-drift'
  readonly fingerprints: readonly {
    readonly id: string
    readonly count: number
    readonly accepted: boolean
  }[]
  readonly unexplained: readonly HistoricalQualificationDifference[]
}

/** Historical differences are rejected unless an exact fingerprint is explicitly accepted. */
export function governHistoricalQualificationDifferences(
  differences: readonly HistoricalQualificationDifference[],
  acceptedFingerprints: ReadonlySet<string> = new Set(),
): HistoricalDifferenceGovernance {
  const groups = new Map<string, number>()
  for (const difference of differences) {
    const id = historicalDifferenceFingerprint(difference)
    groups.set(id, (groups.get(id) ?? 0) + 1)
  }
  const fingerprints = [...groups]
    .map(([id, count]) => ({ id, count, accepted: acceptedFingerprints.has(id) }))
    .sort((left, right) => compare(left.id, right.id))
  const unexplained = differences.filter(
    (difference) => !acceptedFingerprints.has(historicalDifferenceFingerprint(difference)),
  )
  return {
    status: unexplained.length ? 'unexplained-drift' : 'accepted',
    fingerprints,
    unexplained,
  }
}

export function historicalDifferenceFingerprint(
  difference: HistoricalQualificationDifference,
): string {
  return `${difference.field}:${stableValue(difference.historical)}=>${stableValue(difference.candidate)}`
}

function stableValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

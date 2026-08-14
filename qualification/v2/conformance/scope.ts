export interface ConformanceCorpusScope {
  readonly specifications: readonly string[]
  readonly observations: readonly string[]
  readonly unobservedSpecifications: readonly string[]
  readonly orphanObservations: readonly string[]
  readonly selected: readonly string[]
}

/**
 * Join authored specification authority to optional analysis evidence without
 * letting the evidence inventory erase an authored module that has no target.
 */
export function conformanceCorpusScope(
  specifications: readonly string[],
  observations: readonly string[],
  requested: readonly string[] = [],
): ConformanceCorpusScope {
  const authoritative = unique(specifications)
  const observed = unique(observations)
  const authoritativeSet = new Set(authoritative)
  const observedSet = new Set(observed)
  const unknown = unique(requested).filter((source) => !authoritativeSet.has(source))
  if (unknown.length) {
    throw new Error(`Unknown specification module${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`)
  }
  return {
    specifications: authoritative,
    observations: observed,
    unobservedSpecifications: authoritative.filter((source) => !observedSet.has(source)),
    orphanObservations: observed.filter((source) => !authoritativeSet.has(source)),
    selected: requested.length ? unique(requested) : authoritative,
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

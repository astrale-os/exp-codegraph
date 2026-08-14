import type { AnalysisFailure, AnalysisLimit, Completeness } from '../facts/index.ts'

/**
 * Combine epistemic results without making producer or materializer traversal
 * order observable through the query contract.
 */
export function combineCompleteness(
  left: Completeness | undefined,
  right: Completeness,
): Completeness {
  if (left?.kind === 'unavailable' || right.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      reasons: canonicalReasons([
        ...(left?.kind === 'unavailable' ? left.reasons : []),
        ...(right.kind === 'unavailable' ? right.reasons : []),
      ]),
    }
  }
  if (left?.kind === 'partial' || right.kind === 'partial') {
    return {
      kind: 'partial',
      reasons: canonicalReasons([
        ...(left?.kind === 'partial' ? left.reasons : []),
        ...(right.kind === 'partial' ? right.reasons : []),
      ]),
    }
  }
  return { kind: 'complete' }
}

function canonicalReasons<Reason extends AnalysisLimit | AnalysisFailure>(
  reasons: readonly Reason[],
): readonly Reason[] {
  const byIdentity = new Map(reasons.map((reason) => [stableJson(reason), reason]))
  return [...byIdentity]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, reason]) => reason)
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

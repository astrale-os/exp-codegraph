import type {
  ObservationIssue,
  ObservedExport,
  ObservedSurface,
  SourceLocation,
} from '../../analysis/typescript/surface/model.ts'

/**
 * A facade may rename or omit canonical exports, but it cannot establish a second declaration
 * authority. Every declaration it exposes must already be public through the canonical entrypoint.
 */
export function compareEntrypointFacade(
  canonical: ObservedSurface,
  facade: ObservedSurface,
  location: SourceLocation,
): readonly ObservationIssue[] {
  if (hasUnresolvedEntrypoint(facade)) return []

  const declared = new Set(canonical.exports.map(declarationFact))
  const unexpected = facade.exports
    .map(declarationFact)
    .filter((fact) => !declared.has(fact))
    .sort(compare)
  if (!unexpected.length) return []

  return [
    {
      code: 'MODULE_ENTRYPOINT_FACADE_DRIFT',
      message:
        'Public entrypoint facade exposes declarations outside the canonical entrypoint contract.',
      location,
      actual: { unexpected },
    },
  ]
}

function declarationFact(value: ObservedExport): string {
  return JSON.stringify({
    declaration: value.declaration,
    kind: value.kind,
    typeOnly: value.typeOnly,
  })
}

function hasUnresolvedEntrypoint(surface: ObservedSurface): boolean {
  return surface.issues.some(
    (issue) =>
      issue.code === 'MODULE_ENTRYPOINT_NOT_IN_PROJECT' ||
      issue.code === 'MODULE_ENTRYPOINT_SYMBOL_UNRESOLVED',
  )
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

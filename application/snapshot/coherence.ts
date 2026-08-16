import type { SourceRevisionId } from '../../analysis/index.ts'
import { deriveAnalysisId } from '../../analysis/index.ts'
import type { RepositoryInventory } from '../../repository/index.ts'
import type { SpecificationSnapshot } from '../../specification/index.ts'

/** Refuse to publish a normative snapshot compiled from bytes outside the pinned inventory. */
export function assertSpecificationInventory(
  specifications: readonly SpecificationSnapshot[],
  inventory: RepositoryInventory,
): void {
  const files = new Map(inventory.files.map((file) => [file.path, file] as const))
  const mismatches: string[] = []
  for (const specification of specifications) {
    for (const resource of specificationResources(specification)) {
      const file = files.get(resource.source)
      if (!file) {
        mismatches.push(`${resource.source}:not-in-inventory`)
        continue
      }
      const revision = deriveAnalysisId('source-revision', `${file.source}`, {
        digest: resource.revision,
        encoding: 'bytes',
      }) as SourceRevisionId
      if (revision !== file.revision) mismatches.push(`${resource.source}:revision-mismatch`)
    }
    for (const reference of specification.sourceReferences) {
      if (!files.has(reference.target.source)) {
        mismatches.push(`${reference.target.source}:reference-target-not-in-inventory`)
      }
    }
  }
  if (mismatches.length) {
    throw new Error(
      `Specification sources changed during refresh: ${[...new Set(mismatches)].sort().join(', ')}`,
    )
  }
}

interface RevisionedSource {
  readonly source: string
  readonly revision: string
  readonly model?: {
    readonly sources: readonly { readonly file: string; readonly revision: string }[]
    readonly dependencies?: readonly { readonly file: string; readonly revision: string }[]
  }
}

function specificationResources(specification: SpecificationSnapshot): readonly RevisionedSource[] {
  const resources: RevisionedSource[] = [
    ...(specification.module.api ? [specification.module.api] : []),
    ...(specification.module.code ? [specification.module.code] : []),
    ...(specification.module.internal ? [specification.module.internal] : []),
    ...specification.module.ports,
    ...specification.schemas,
    ...specification.examples,
    ...specification.capabilities,
    ...specification.flows,
    ...specification.laws,
    ...specification.states,
    ...(specification.limits ? [specification.limits] : []),
    ...(specification.layout ? [specification.layout] : []),
    ...specification.benchmarks,
    ...specification.packages,
    ...specification.packagePatterns,
    ...specification.module.packageAuthority.packages,
    ...specification.module.packageAuthority.packagePatterns,
  ]
  const expanded = resources.flatMap((resource) => [
    resource,
    ...(resource.model?.sources.map((source) => ({
      source: source.file,
      revision: source.revision,
    })) ?? []),
    ...(resource.model?.dependencies?.map((source) => ({
      source: source.file,
      revision: source.revision,
    })) ?? []),
  ])
  return [...new Map(expanded.map((resource) => [resource.source, resource] as const)).values()]
}

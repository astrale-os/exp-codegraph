import type { SpecificationSnapshot } from '../../specification/index.ts'
import { compileSpecificationSnapshots } from '../../specification/index.ts'
import type { RepositoryInventory, RepositorySourceService } from '../../repository/index.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from '../limits.ts'
import type { ApplicationSpecificationAnchor } from './model.ts'
import {
  planApplicationDependencyOptimization,
  type ApplicationDependencyOptimizationPlan,
} from './dependency.optimization.ts'
import { planApplicationSpecificationAnchors } from './select.ts'

export interface RequestedSpecificationCompilation {
  readonly specifications: readonly SpecificationSnapshot[]
  readonly dependencyPlan: ApplicationDependencyOptimizationPlan
  readonly primaryOwners: number
  readonly waves: number
  readonly fallbackOwners: number
  readonly fallbackSources: readonly string[]
  readonly planningMilliseconds: number
}

/** Compile a focused owner set and its exact authored declaration/support closure in bounded waves. */
export async function compileRequestedSpecificationClosure(
  root: string,
  anchors: readonly ApplicationSpecificationAnchor[],
  select: readonly string[],
  inventory: RepositoryInventory,
  sources: RepositorySourceService,
  compile: typeof compileSpecificationSnapshots,
  signal?: AbortSignal,
): Promise<RequestedSpecificationCompilation> {
  const planningStarted = performance.now()
  const planned = planApplicationSpecificationAnchors(root, anchors, select)
  const emptyPlan: ApplicationDependencyOptimizationPlan = {
    outcome: 'planned',
    owners: [],
    inspectedSources: 0,
    dependencyEdges: 0,
    unavailableSources: 0,
  }
  if (planned.diagnostics.length) {
    return {
      specifications: [],
      dependencyPlan: emptyPlan,
      primaryOwners: 0,
      waves: 0,
      fallbackOwners: 0,
      fallbackSources: [],
      planningMilliseconds: performance.now() - planningStarted,
    }
  }
  const dependencyPlan = await planApplicationDependencyOptimization(
    root,
    anchors,
    planned.primary,
    inventory,
    sources,
    signal,
  )
  const planningMilliseconds = performance.now() - planningStarted
  const anchorBySource = new Map(anchors.map((anchor) => [anchor.source, anchor]))
  const compiled = new Map<string, SpecificationSnapshot>()
  const fallback = new Set<string>()
  let waves = 0
  let pending = [...dependencyPlan.owners]
  while (pending.length) {
    signal?.throwIfAborted()
    waves += 1
    const wave = await compile(
      root,
      pending.map((anchor) => anchor.directory),
      {
        maximumConcurrency:
          TYPE_SPEC_APPLICATION_LIMITS.maximumConcurrentSpecificationCompilations,
      },
    )
    const next = new Map<string, ApplicationSpecificationAnchor>()
    for (const specification of wave) compiled.set(specification.source, specification)
    for (const specification of wave) {
      const dependencies = [
        ...specification.sourceReferences.map((reference) => reference.target.source),
        ...declarationDependencies(specification),
      ]
      for (const source of dependencies) {
        const anchor = anchorBySource.get(source)
        if (anchor && !compiled.has(source)) {
          next.set(source, anchor)
          fallback.add(source)
        }
      }
    }
    pending = [...next.values()].sort((left, right) => left.source.localeCompare(right.source))
  }
  return {
    specifications: [...compiled.values()].sort((left, right) => left.source.localeCompare(right.source)),
    dependencyPlan,
    primaryOwners: planned.primary.length,
    waves,
    fallbackOwners: fallback.size,
    fallbackSources: [...fallback].sort(),
    planningMilliseconds,
  }
}

function declarationDependencies(specification: SpecificationSnapshot): readonly string[] {
  return [
    specification.module.api,
    specification.module.internal,
    ...specification.module.ports,
  ].flatMap((resource) => resource?.model?.dependencies?.map((entry) => entry.file) ?? [])
}

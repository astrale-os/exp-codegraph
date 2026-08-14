import type { ViewerCodeDependency as CodeDependency } from '../../viewer-host/code.ts'

export type CodeExitKind = 'package' | 'platform' | 'specification'
export type CodeExitUsage = 'runtime' | 'types' | 'runtime-and-types'

export interface CodeExitTarget {
  readonly id: string
  readonly label: string
  readonly kind: CodeExitKind
  readonly usage: CodeExitUsage
}

/** Direct architectural destinations reached outside one owned code boundary. */
export function fileExitTargets(
  file: string,
  dependencies: readonly CodeDependency[],
): readonly CodeExitTarget[] {
  return exitTargets(dependencies.filter((dependency) => dependency.sourceFile === file))
}

/** Unique architectural destinations reached by any file in one internal module. */
export function moduleExitTargets(
  module: string,
  dependencies: readonly CodeDependency[],
): readonly CodeExitTarget[] {
  return exitTargets(dependencies.filter((dependency) => dependency.sourceModule === module))
}

export function exitTargetSummary(targets: readonly CodeExitTarget[]): string {
  const prefix = targets.length === 1 ? 'External destination' : 'External destinations'
  return `${prefix}: ${targets.map(describeExitTarget).join(', ')}`
}

function exitTargets(dependencies: readonly CodeDependency[]): readonly CodeExitTarget[] {
  const grouped = new Map<string, CodeDependency[]>()
  for (const dependency of dependencies) {
    if (!exitKind(dependency.targetModule)) continue
    const current = grouped.get(dependency.targetModule) ?? []
    current.push(dependency)
    grouped.set(dependency.targetModule, current)
  }

  return [...grouped.entries()]
    .map(([id, values]) => {
      const kind = exitKind(id)!
      const runtime = values.some(
        (dependency) => !dependency.typeOnly && dependency.kind !== 'type',
      )
      const types = values.some((dependency) => dependency.typeOnly || dependency.kind === 'type')
      const usage: CodeExitUsage =
        runtime && types ? 'runtime-and-types' : runtime ? 'runtime' : 'types'
      return {
        id,
        label: id.slice(id.indexOf(':') + 1),
        kind,
        usage,
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
}

function exitKind(target: string): CodeExitKind | undefined {
  if (target.startsWith('package:')) return 'package'
  if (target.startsWith('platform:')) return 'platform'
  if (target.startsWith('spec:')) return 'specification'
  return undefined
}

function describeExitTarget(target: CodeExitTarget): string {
  const usage =
    target.usage === 'runtime-and-types'
      ? 'runtime + types'
      : target.usage === 'types'
        ? 'types only'
        : 'runtime'
  return `${target.label} (${target.kind}, ${usage})`
}

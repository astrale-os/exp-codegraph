import { posix } from 'node:path'

import type { CapabilityCitation, CapabilityCoordinate } from '../specification/index.ts'
import type { CliOutput } from './report.ts'

import { assertCanonicalRepositoryPath } from '../application/change/index.ts'
import {
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from '../application/discovery/index.ts'
import { capabilitiesCiting, loadModuleSemanticDeclarations } from '../specification/index.ts'
import { catalogChangedFiles } from './changes.ts'
import { terminalText } from './report.ts'

export interface ImpactedLaw extends CapabilityCoordinate {
  readonly source: string
  /** Changed files this law is attached to, each with the kind of attachment. */
  readonly reasons: readonly { readonly kind: 'test' | 'code'; readonly file: string }[]
}

export interface LawlessModule {
  readonly module: string
  /** Changed non-test source files owned by a module that declares no law. */
  readonly files: readonly string[]
}

/** What a change set asks a reader to re-read; computed on demand and never stored. */
export interface ChangedLawImpact {
  readonly laws: readonly ImpactedLaw[]
  readonly capabilities: readonly CapabilityCitation[]
  readonly lawless: readonly LawlessModule[]
}

const SOURCE_FILE = /\.(?:cts|mts|tsx?|cjs|mjs|jsx?)$/u
/** The default layout ignore patterns: what a module root treats as test material. */
const TEST_FILE =
  /(?:^|\/)(?:__tests__|tests)\/|(?:^|\/)\.check-workspace\.cjs$|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u

/**
 * Relate changed files to the laws attached to them, at file granularity.
 *
 * Only capability and law descriptors are parsed: no contract is compiled and nothing is executed,
 * so the result is available before, and independently of, the check itself.
 */
export async function changedLawImpact(
  root: string,
  files: readonly string[],
  exclude: readonly string[] = [],
): Promise<ChangedLawImpact> {
  const catalogRoot = await resolveApplicationRoot(root)
  const changed = new Set(await catalogChangedFiles(catalogRoot, files))
  const directories = await discoverSpecificationDirectories(catalogRoot, { exclude })
  const modules = (
    await Promise.all(
      directories.map((directory) => loadModuleSemanticDeclarations(catalogRoot, directory)),
    )
  ).flatMap((module) => (module ? [module] : []))

  const laws: ImpactedLaw[] = []
  for (const module of modules) {
    for (const resource of module.laws) {
      for (const definition of resource.definitions) {
        const reasons = [
          ...(definition.tests ?? []).map((reference) => ({ kind: 'test' as const, reference })),
          ...(definition.code ?? []).map((reference) => ({ kind: 'code' as const, reference })),
        ].flatMap(({ kind, reference }) => {
          const file = evidenceFile(module.root, reference.file)
          return file !== undefined && changed.has(file) ? [{ kind, file }] : []
        })
        if (!reasons.length) continue
        laws.push({
          module: module.root,
          id: definition.id,
          source: resource.source,
          reasons: uniqueReasons(reasons),
        })
      }
    }
  }

  const lawful = new Map(
    modules.map((module) => [
      module.root,
      module.laws.some((resource) => resource.definitions.length > 0),
    ]),
  )
  const lawless = new Map<string, string[]>()
  for (const file of [...changed].sort(compare)) {
    if (!SOURCE_FILE.test(file) || TEST_FILE.test(file) || specificationMaterial(file)) continue
    const owner = owningModule(lawful, file)
    if (owner === undefined || lawful.get(owner)) continue
    lawless.set(owner, [...(lawless.get(owner) ?? []), file])
  }

  return {
    laws: laws.sort(
      (left, right) => compare(left.module, right.module) || compare(left.id, right.id),
    ),
    capabilities: capabilitiesCiting(modules, laws),
    lawless: [...lawless]
      .sort(([left], [right]) => compare(left, right))
      .map(([module, owned]) => ({ module, files: owned })),
  }
}

/** Print the impact section. It is informational and never contributes to the exit status. */
export function printLawImpact(output: CliOutput, impact: ChangedLawImpact): void {
  output.out(
    `Impact: ${count(impact.laws.length, 'law')}, ${count(impact.capabilities.length, 'capability', 'capabilities')}, ${count(impact.lawless.length, 'module')} without a law.`,
  )
  for (const law of impact.laws) {
    output.out(
      `  law ${terminalText(coordinate(law))}: ${law.reasons
        .map((reason) => `${reason.kind} ${terminalText(reason.file)} changed`)
        .join(', ')}`,
    )
  }
  for (const capability of impact.capabilities) {
    output.out(
      `  capability ${terminalText(coordinate(capability))}: cites ${[
        ...capability.cites.laws.map((law) => `law ${terminalText(coordinate(law))}`),
        ...capability.cites.capabilities.map(
          (cited) => `capability ${terminalText(coordinate(cited))}`,
        ),
      ].join(', ')}`,
    )
  }
  for (const module of impact.lawless) {
    const [first, ...others] = module.files
    output.out(
      `  module ${terminalText(module.module)}: no law, ${count(module.files.length, 'changed source file')} (${terminalText(first!)}${others.length ? `, +${others.length} more` : ''})`,
    )
  }
}

export function impactIsEmpty(impact: ChangedLawImpact): boolean {
  return !impact.laws.length && !impact.capabilities.length && !impact.lawless.length
}

/** Catalog-relative file an evidence reference names, when it stays inside the catalog. */
function evidenceFile(moduleRoot: string, reference: string): string | undefined {
  if (reference.startsWith('/') || /^[A-Za-z]:/u.test(reference) || reference.includes('\\')) {
    return
  }
  const file = posix.normalize(posix.join(moduleRoot, reference))
  try {
    return assertCanonicalRepositoryPath(file)
  } catch {
    return
  }
}

/** Nearest specified module whose directory contains the file. */
function owningModule(modules: ReadonlyMap<string, boolean>, file: string): string | undefined {
  let directory = posix.dirname(file)
  for (;;) {
    if (modules.has(directory)) return directory
    if (directory === '.') return
    directory = posix.dirname(directory)
  }
}

function specificationMaterial(file: string): boolean {
  return file.split('/').some((segment) => segment === '.spec' || segment === '.history')
}

function uniqueReasons(reasons: ImpactedLaw['reasons']): ImpactedLaw['reasons'] {
  return [
    ...new Map(reasons.map((reason) => [`${reason.kind}\0${reason.file}`, reason])).values(),
  ]
}

function coordinate(value: CapabilityCoordinate): string {
  return `${value.module}#${value.id}`
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { SpecificationSnapshot } from '../../specification/index.ts'
import type {
  SelectApplicationSpecificationsOptions,
  SelectedApplicationSpecifications,
} from './model.ts'

/** Select requested owners, optional dependents, and their normative dependency closure. */
export function selectApplicationSpecifications(
  root: string,
  specifications: readonly SpecificationSnapshot[],
  options: SelectApplicationSpecificationsOptions = {},
): SelectedApplicationSpecifications {
  if (!options.select?.length) {
    return {
      selection: { kind: 'full', authority: 'full-ci' },
      included: specifications,
      qualification: specifications,
      diagnostics: [],
    }
  }
  let requested: readonly string[]
  try {
    requested = [...new Set(options.select.map((value) => selectionTarget(root, value)))].sort()
  } catch (error) {
    return invalidSelection(specifications, options, 'SELECTION_INVALID', error)
  }
  const bySource = new Map(specifications.map((specification) => [specification.source, specification]))
  const dependencies = new Map(
    specifications.map((specification) => [
      specification.source,
      new Set(
        specification.sourceReferences
          .map((reference) => reference.target.source)
          .filter((source) => source !== specification.source && bySource.has(source)),
      ),
    ] as const),
  )
  const selected = new Set(
    requested.flatMap((target) => selectedOwners(specifications, target)),
  )
  if (!selected.size) {
    return invalidSelection(
      specifications,
      options,
      'SELECTION_EMPTY',
      `No specification matches: ${requested.join(', ')}`,
      requested,
    )
  }
  const primary = [...selected].sort()
  if (options.includeDependents) {
    let changed = true
    while (changed) {
      changed = false
      for (const [source, imports] of dependencies) {
        if (selected.has(source) || ![...imports].some((dependency) => selected.has(dependency))) continue
        selected.add(source)
        changed = true
      }
    }
  }
  const closure = new Set(selected)
  const pending = [...selected]
  while (pending.length) {
    for (const dependency of dependencies.get(pending.pop()!) ?? []) {
      if (closure.has(dependency)) continue
      closure.add(dependency)
      pending.push(dependency)
    }
  }
  const support = [...closure].filter((source) => !selected.has(source)).sort()
  const qualified = specifications.filter((specification) => closure.has(specification.source))
  const included = options.focused ? qualified : [...specifications]
  return {
    selection: {
      kind: 'focused',
      authority: 'advisory',
      requested,
      primary,
      selected: [...selected].sort(),
      support,
      included: included.map((specification) => specification.source),
      includeDependents: Boolean(options.includeDependents),
    },
    included,
    qualification: qualified,
    diagnostics: [],
  }
}

function invalidSelection(
  specifications: readonly SpecificationSnapshot[],
  options: SelectApplicationSpecificationsOptions,
  code: string,
  error: unknown,
  requested: readonly string[] = [],
): SelectedApplicationSpecifications {
  const included = options.focused ? [] : [...specifications]
  return {
    selection: {
      kind: 'focused',
      authority: 'advisory',
      requested,
      primary: [],
      selected: [],
      support: [],
      included: included.map((specification) => specification.source),
      includeDependents: Boolean(options.includeDependents),
    },
    included,
    qualification: [],
    diagnostics: [
      {
        code,
        message: error instanceof Error ? error.message : String(error),
        file: '.',
        line: 1,
        column: 1,
      },
    ],
  }
}

function selectionTarget(root: string, input: string): string {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(root, input)
  const path = relative(resolve(root), absolute)
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error(`Selected path is outside the repository root: ${input}`)
  }
  return portable(path || '.')
}

function selectedOwners(
  specifications: readonly SpecificationSnapshot[],
  target: string,
): string[] {
  if (target === '.') return specifications.map((specification) => specification.source)
  const exactSource = specifications.find((specification) =>
    target === specification.source || target === dirname(specification.source),
  )
  if (exactSource) return [exactSource.source]
  if (specifications.some((specification) => target === specification.root)) {
    return specifications
      .filter((specification) =>
        specification.root === target || specification.root.startsWith(`${target}/`),
      )
      .map((specification) => specification.source)
  }
  const descendants = specifications.filter((specification) =>
    specification.root.startsWith(`${target}/`),
  )
  if (descendants.length) return descendants.map((specification) => specification.source)
  const containing = specifications.filter(
    (specification) =>
      specification.root !== '.' && target.startsWith(`${specification.root}/`),
  )
  const longest = Math.max(0, ...containing.map((specification) => specification.root.length))
  return containing
    .filter((specification) => specification.root.length === longest)
    .map((specification) => specification.source)
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

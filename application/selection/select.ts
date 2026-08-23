import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { SpecificationSnapshot } from '../../specification/index.ts'
import type {
  SelectApplicationSpecificationsOptions,
  ApplicationSpecificationAnchor,
  PlannedApplicationSpecificationAnchors,
  SelectedApplicationSpecifications,
} from './model.ts'

export function applicationSpecificationAnchors(
  root: string,
  directories: readonly string[],
): readonly ApplicationSpecificationAnchor[] {
  return directories
    .map((directory) => {
      const moduleRoot = dirname(directory)
      const sourceRoot = portable(relative(root, moduleRoot)) || '.'
      return {
        directory,
        source: portable(relative(root, join(directory, 'api.d.ts'))),
        root: sourceRoot,
        title:
          sourceRoot === '.'
            ? basename(root) || 'module'
            : sourceRoot.split('/').filter(Boolean).join('.'),
      }
    })
    .sort((left, right) => left.source.localeCompare(right.source))
}

export function planApplicationSpecificationAnchors(
  root: string,
  anchors: readonly ApplicationSpecificationAnchor[],
  select: readonly string[],
): PlannedApplicationSpecificationAnchors {
  let requested: readonly string[]
  try {
    requested = normalizeApplicationSelectionTargets(root, select)
  } catch (error) {
    return {
      requested: [],
      primary: [],
      diagnostics: [selectionDiagnostic('SELECTION_INVALID', error)],
    }
  }
  const primary = requested.flatMap((target) => applicationSelectionOwners(anchors, target))
  if (!primary.length) {
    return {
      requested,
      primary: [],
      diagnostics: [
        selectionDiagnostic('SELECTION_EMPTY', `No specification matches: ${requested.join(', ')}`),
      ],
    }
  }
  const bySource = new Map(primary.map((anchor) => [anchor.source, anchor]))
  return { requested, primary: [...bySource.values()].sort(compareSource), diagnostics: [] }
}

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
    requested = normalizeApplicationSelectionTargets(root, options.select)
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
  const selected = new Set(requested.flatMap((target) =>
    applicationSelectionOwners(specifications, target).map((value) => value.source),
  ))
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

/** Normalize authored selection arguments once at the application boundary. */
export function normalizeApplicationSelectionTargets(
  root: string,
  inputs: readonly string[],
): readonly string[] {
  return [...new Set(inputs.map((input) => selectionTarget(root, input)))].sort()
}

function selectionTarget(root: string, input: string): string {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(root, input)
  const path = relative(resolve(root), absolute)
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error(`Selected path is outside the repository root: ${input}`)
  }
  return portable(path || '.')
}

/** Match one normalized target against portable owner coordinates. */
export function applicationSelectionOwners<Owner extends { readonly source: string; readonly root: string }>(
  specifications: readonly Owner[],
  target: string,
): Owner[] {
  if (target === '.') return [...specifications]
  const exactSource = specifications.find((specification) =>
    target === specification.source || target === dirname(specification.source),
  )
  if (exactSource) return [exactSource]
  if (specifications.some((specification) => target === specification.root)) {
    return specifications
      .filter((specification) =>
        specification.root === target || specification.root.startsWith(`${target}/`),
      )
  }
  const descendants = specifications.filter((specification) =>
    specification.root.startsWith(`${target}/`),
  )
  if (descendants.length) return descendants
  const containing = specifications.filter(
    (specification) =>
      specification.root !== '.' && target.startsWith(`${specification.root}/`),
  )
  const longest = Math.max(0, ...containing.map((specification) => specification.root.length))
  return containing
    .filter((specification) => specification.root.length === longest)
}

function selectionDiagnostic(code: string, error: unknown) {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    file: '.',
    line: 1,
    column: 1,
  }
}

function compareSource<Owner extends { readonly source: string }>(left: Owner, right: Owner): number {
  return left.source.localeCompare(right.source)
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

import type { TypeSpecApplicationSelection } from '../application/index.ts'
import type { Diagnostic } from '../source/diagnostic.ts'

export const CLI_CHECK_REPORT_FORMAT = 'astrale.codegraph.check-report'
export const CLI_CHECK_REPORT_VERSION = 1

export type CliCheckOutputFormat = 'text' | 'json'

export interface CliDiagnosticGroup {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointers: readonly (string | null)[]
}

export type CliCheckScope =
  | {
      readonly kind: 'full'
      readonly specifications: readonly string[]
    }
  | {
      readonly kind: 'focused'
      readonly requested: readonly string[]
      readonly selected: readonly string[]
      readonly support: readonly string[]
    }

export interface CliCheckReport {
  readonly format: typeof CLI_CHECK_REPORT_FORMAT
  readonly version: typeof CLI_CHECK_REPORT_VERSION
  readonly command: 'check'
  readonly status: 'pass' | 'fail'
  readonly evidence: {
    readonly repository: string
    readonly inventory: string
    readonly snapshot: string
  }
  readonly scope: CliCheckScope
  readonly qualificationFailed: boolean
  readonly diagnostics: readonly CliDiagnosticGroup[]
  readonly summary: {
    readonly specifications: number
    readonly diagnosticCauses: number
    readonly diagnosticOccurrences: number
  }
}

interface MutableDiagnosticGroup {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly pointers: Array<string | null>
  readonly observedPointers: Set<string | null>
}

/** Losslessly coalesce only projection variants of one exact source diagnostic cause. */
export function groupDiagnostics(values: readonly Diagnostic[]): readonly CliDiagnosticGroup[] {
  const groups = new Map<string, MutableDiagnosticGroup>()
  for (const value of values) {
    const cause = JSON.stringify([
      value.code,
      value.message,
      value.file,
      value.line,
      value.column,
    ])
    const pointer = value.pointer ?? null
    const existing = groups.get(cause)
    if (existing) {
      if (!existing.observedPointers.has(pointer)) {
        existing.observedPointers.add(pointer)
        existing.pointers.push(pointer)
      }
      continue
    }
    groups.set(cause, {
      code: value.code,
      message: value.message,
      file: value.file,
      line: value.line,
      column: value.column,
      pointers: [pointer],
      observedPointers: new Set([pointer]),
    })
  }
  return [...groups.values()].map(({ observedPointers: _, ...group }) => group)
}

export function createCliCheckReport(input: {
  readonly repository: string
  readonly inventory: string
  readonly snapshot: string
  readonly selection: TypeSpecApplicationSelection
  readonly specificationSources: readonly string[]
  readonly diagnostics: readonly CliDiagnosticGroup[]
  readonly qualificationFailed: boolean
}): CliCheckReport {
  const diagnosticOccurrences = input.diagnostics.reduce(
    (total, diagnostic) => total + diagnostic.pointers.length,
    0,
  )
  const scope: CliCheckScope =
    input.selection.kind === 'full'
      ? { kind: 'full', specifications: input.specificationSources }
      : {
          kind: 'focused',
          requested: input.selection.requested,
          selected: input.selection.selected,
          support: input.selection.support,
        }
  return {
    format: CLI_CHECK_REPORT_FORMAT,
    version: CLI_CHECK_REPORT_VERSION,
    command: 'check',
    status:
      input.diagnostics.length > 0 || input.qualificationFailed ? 'fail' : 'pass',
    evidence: {
      repository: input.repository,
      inventory: input.inventory,
      snapshot: input.snapshot,
    },
    scope,
    qualificationFailed: input.qualificationFailed,
    diagnostics: input.diagnostics,
    summary: {
      specifications:
        scope.kind === 'full'
          ? scope.specifications.length
          : scope.selected.length + scope.support.length,
      diagnosticCauses: input.diagnostics.length,
      diagnosticOccurrences,
    },
  }
}

export function encodeCliCheckReport(report: CliCheckReport): string {
  return JSON.stringify(report, null, 2)
}

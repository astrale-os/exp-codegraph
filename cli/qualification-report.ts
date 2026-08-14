import type {
  ConformanceDiagnostic,
  ConformanceRuleResult,
  QualificationProfileResult,
  QualificationSnapshot,
} from '../conformance/index.ts'
import type { Diagnostic } from '../source/diagnostic.ts'
import type { CliOutput } from './report.ts'
import { printDiagnostic, terminalText } from './report.ts'

export function qualificationDiagnostics(
  qualification: QualificationSnapshot,
): readonly Diagnostic[] {
  return qualification.profiles.flatMap((profile) =>
    profile.rules.flatMap((rule) =>
      rule.diagnostics.map((diagnostic) => sourceDiagnostic(qualification, diagnostic)),
    ),
  )
}

export function printQualificationProfile(
  output: CliOutput,
  source: string,
  profile: QualificationProfileResult,
): void {
  const coverage = ` forward=${profile.coverage.forward.matched}/${profile.coverage.forward.total} inverse=${profile.coverage.inverse.matched}/${profile.coverage.inverse.total}`
  const message = `${terminalText(source)} [${terminalText(profile.id)}] version=${terminalText(profile.version)} status=${profile.status}${terminalText(coverage)}`
  const write = profile.status === 'pass' ? output.out : output.error
  write(message)
}

export function printQualificationRule(
  output: CliOutput,
  qualification: QualificationSnapshot,
  rule: ConformanceRuleResult,
): void {
  if (rule.status === 'pass' && !rule.diagnostics.length) return
  if (!rule.diagnostics.length) {
    output.error(
      `${terminalText(qualification.specification.source)} [${terminalText(rule.rule)}] ${rule.status}`,
    )
    return
  }
  for (const diagnostic of rule.diagnostics) {
    printDiagnostic(output, sourceDiagnostic(qualification, diagnostic))
    if (diagnostic.expected !== undefined) {
      output.error(`  expected: ${terminalText(display(diagnostic.expected))}`)
    }
    if (diagnostic.actual !== undefined) {
      output.error(`  actual: ${terminalText(display(diagnostic.actual))}`)
    }
    if (diagnostic.hint) output.error(`  hint: ${terminalText(diagnostic.hint)}`)
  }
}

/** Print one bounded failure overview while full rule evidence remains behind --details. */
export function printQualificationSummary(
  output: CliOutput,
  qualification: QualificationSnapshot,
): void {
  if (qualification.status === 'pass') return
  const failing = qualification.profiles.filter((profile) => profile.status !== 'pass')
  const diagnostics = failing.flatMap((profile) =>
    profile.rules.flatMap((rule) => rule.diagnostics),
  )
  output.error(
    `${terminalText(qualification.specification.source)} ${qualification.status.toUpperCase()} — ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'} in ${failing.length} profile${failing.length === 1 ? '' : 's'}`,
  )
  for (const profile of failing) {
    output.error(
      `  ${terminalText(profile.id)} ${profile.status} forward=${profile.coverage.forward.matched}/${profile.coverage.forward.total} inverse=${profile.coverage.inverse.matched}/${profile.coverage.inverse.total}`,
    )
    const groups = grouped(diagnosticsFor(profile))
    if (!groups.length) output.error('    No diagnostic details were provided.')
    for (const group of groups) {
      const diagnostic = sourceDiagnostic(qualification, group.diagnostic)
      output.error(
        `    ${terminalText(group.code)} ×${group.count} — ${terminalText(diagnostic.file)}:${diagnostic.line}:${diagnostic.column} ${terminalText(group.diagnostic.message)}`,
      )
    }
  }
}

function sourceDiagnostic(
  qualification: QualificationSnapshot,
  diagnostic: ConformanceDiagnostic,
): Diagnostic {
  const actual = diagnostic.actual
  const located = isDiagnostic(actual) ? actual : undefined
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    file: located?.file ?? qualification.specification.source,
    line: located?.line ?? 1,
    column: located?.column ?? 1,
    ...(diagnostic.specificationPointer || located?.pointer
      ? { pointer: diagnostic.specificationPointer ?? located!.pointer }
      : {}),
  }
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Diagnostic).code === 'string' &&
      typeof (value as Diagnostic).message === 'string' &&
      typeof (value as Diagnostic).file === 'string' &&
      Number.isSafeInteger((value as Diagnostic).line) &&
      Number.isSafeInteger((value as Diagnostic).column),
  )
}

function diagnosticsFor(profile: QualificationProfileResult): readonly ConformanceDiagnostic[] {
  return profile.rules.flatMap((rule) => rule.diagnostics)
}

function grouped(values: readonly ConformanceDiagnostic[]): readonly {
  code: string
  count: number
  diagnostic: ConformanceDiagnostic
}[] {
  const groups = new Map<string, { code: string; count: number; diagnostic: ConformanceDiagnostic }>()
  for (const diagnostic of values) {
    const current = groups.get(diagnostic.code)
    if (current) current.count += 1
    else groups.set(diagnostic.code, { code: diagnostic.code, count: 1, diagnostic })
  }
  return [...groups.values()].sort((left, right) => left.code.localeCompare(right.code))
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

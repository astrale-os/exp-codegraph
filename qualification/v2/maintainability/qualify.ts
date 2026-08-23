import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { stableJson } from '../../../analysis/identity/model.ts'
import { measureMaintainability, type MaintainabilityMeasurement } from './measure.ts'
import { assertMaintainabilityBudgetLock } from './lock.ts'

const execFile = promisify(execFileCallback)
const root = resolve(argument('--root') ?? '.')
const budgetPath = resolve(root, argument('--budget') ?? 'qualification/v2/maintainability/budget.json')
const budgetBytes = await readFile(budgetPath)
await assertMaintainabilityBudgetLock(budgetPath, budgetBytes)
const budget = JSON.parse(budgetBytes.toString('utf8')) as Budget
assertBudget(budget)
const baselinePath = resolve(root, budget.baselineEvidence)
const baselineBytes = await readFile(baselinePath)
if (digest(baselineBytes) !== budget.baselineSha256) {
  throw new Error('Maintainability baseline evidence digest does not match the ratified budget.')
}
const baselineDocument = JSON.parse(baselineBytes.toString('utf8')) as {
  readonly subject?: { readonly codegraph?: unknown }
  readonly complexity?: unknown
}
if (baselineDocument.subject?.codegraph !== budget.baselineRevision) {
  throw new Error('Maintainability baseline revision does not match the ratified evidence subject.')
}
const baseline = baselineDocument.complexity as Baseline
assertBaseline(baseline)
await execFile('git', ['-C', root, 'cat-file', '-e', `${budget.baselineRevision}^{commit}`])

const measurement = await measureMaintainability(root)
const violations = evaluate(measurement, baseline, budget)
const revision = (
  await execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
).stdout.trim()
const dirty = Boolean(
  (await execFile('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })).stdout.trim(),
)
const body = {
  format: 'astrale.codegraph.maintainability-qualification' as const,
  version: 1 as const,
  status: violations.length ? ('failed' as const) : ('qualified' as const),
  subject: { revision, dirty },
  baseline: { revision: budget.baselineRevision, sha256: digest(baselineBytes) },
  budget: { sha256: digest(budgetBytes) },
  measurement,
  violations,
}
const receipt = { ...body, receiptSha256: digest(Buffer.from(stableJson(body))) }
const serialized = `${JSON.stringify(receipt, null, 2)}\n`
const output = argument('--output')
if (output) await writeFile(resolve(output), serialized, 'utf8')
process.stdout.write(serialized)
if (violations.length) process.exitCode = 1

interface Budget {
  readonly format: 'astrale.codegraph.maintainability-budget'
  readonly version: 1
  readonly baselineRevision: string
  readonly baselineEvidence: string
  readonly baselineSha256: string
  readonly maximumDelta: {
    readonly files: number
    readonly directories: number
    readonly physicalLines: number
    readonly over250: number
    readonly over500: number
    readonly over1000: number
    readonly over2000: number
    readonly relativeImportCycles: number
    readonly boundaryDefinitions: number
    readonly repeatedBoundaryNames: number
  }
  readonly maximumFileLines: number
  readonly allowedOptimizationImports: readonly (readonly [string, string])[]
}

interface Baseline {
  readonly files: number
  readonly directories: number
  readonly physicalLines: number
  readonly sizeBands: MaintainabilityMeasurement['sizeBands']
  readonly relativeImportCycles: readonly (readonly string[])[]
  readonly boundaryDefinitions: number
  readonly repeatedBoundaryNames: readonly (readonly [string, number])[]
}

function evaluate(
  current: MaintainabilityMeasurement,
  baseline: Baseline,
  budget: Budget,
): readonly string[] {
  const violations: string[] = []
  maximum(violations, 'files', current.files, baseline.files, budget.maximumDelta.files)
  maximum(
    violations,
    'directories',
    current.directories,
    baseline.directories,
    budget.maximumDelta.directories,
  )
  maximum(
    violations,
    'physicalLines',
    current.physicalLines,
    baseline.physicalLines,
    budget.maximumDelta.physicalLines,
  )
  for (const band of ['over250', 'over500', 'over1000', 'over2000'] as const) {
    maximum(
      violations,
      band,
      current.sizeBands[band],
      baseline.sizeBands[band],
      budget.maximumDelta[band],
    )
  }
  maximum(
    violations,
    'relativeImportCycles',
    current.relativeImportCycles.length,
    baseline.relativeImportCycles.length,
    budget.maximumDelta.relativeImportCycles,
  )
  maximum(
    violations,
    'boundaryDefinitions',
    current.boundaryDefinitions,
    baseline.boundaryDefinitions,
    budget.maximumDelta.boundaryDefinitions,
  )
  maximum(
    violations,
    'repeatedBoundaryNames',
    current.repeatedBoundaryNames.length,
    baseline.repeatedBoundaryNames.length,
    budget.maximumDelta.repeatedBoundaryNames,
  )
  const largest = current.largest[0]
  if (largest && largest[1] > budget.maximumFileLines) {
    violations.push(
      `maximumFileLines actual=${largest[1]} maximum=${budget.maximumFileLines} file=${largest[0]}`,
    )
  }
  const allowed = new Set(budget.allowedOptimizationImports.map((entry) => stableJson(entry)))
  for (const entry of current.optimizationImports) {
    if (!allowed.has(stableJson(entry))) {
      violations.push(`optimizationImport unapproved=${entry[0]}:${entry[1]}`)
    }
  }
  for (const file of current.optimizationFiles) {
    if (!current.optimizationImports.some((entry) => resolveImport(entry[0], entry[1]) === file)) {
      violations.push(`optimizationFile unowned=${file}`)
    }
  }
  return violations.sort()
}

function maximum(
  violations: string[],
  name: string,
  actual: number,
  baseline: number,
  delta: number,
): void {
  if (actual > baseline + delta) {
    violations.push(`${name} actual=${actual} baseline=${baseline} budget=${delta}`)
  }
}

function resolveImport(owner: string, specifier: string): string {
  const segments = owner.split('/')
  segments.pop()
  for (const segment of specifier.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function assertBudget(value: Budget): void {
  if (
    value.format !== 'astrale.codegraph.maintainability-budget' ||
    value.version !== 1 ||
    !/^[0-9a-f]{40}$/u.test(value.baselineRevision) ||
    !/^[0-9a-f]{64}$/u.test(value.baselineSha256) ||
    !value.baselineEvidence ||
    !Number.isSafeInteger(value.maximumFileLines) ||
    value.maximumFileLines < 1 ||
    !Array.isArray(value.allowedOptimizationImports)
  ) {
    throw new Error('Maintainability budget is invalid.')
  }
  for (const limit of Object.values(value.maximumDelta)) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Maintainability budget is invalid.')
  }
}

function assertBaseline(value: Baseline): void {
  if (
    !value ||
    !Number.isSafeInteger(value.files) ||
    !Number.isSafeInteger(value.directories) ||
    !Number.isSafeInteger(value.physicalLines) ||
    !Array.isArray(value.relativeImportCycles) ||
    !Array.isArray(value.repeatedBoundaryNames)
  ) {
    throw new Error('Maintainability baseline evidence is invalid.')
  }
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { stableJson } from '../../../analysis/identity/model.ts'
import { measureMaintainability, type MaintainabilityMeasurement } from './measure.ts'
import { assertMaintainabilityBudgetLock } from './lock.ts'

const execFile = promisify(execFileCallback)
const root = resolve(argument('--root') ?? '.')
const receiptPath = resolve(requiredArgument('--receipt'))
const budgetPath = resolve(root, argument('--budget') ?? 'qualification/v2/maintainability/budget.json')
const [receiptBytes, budgetBytes] = await Promise.all([readFile(receiptPath), readFile(budgetPath)])
await assertMaintainabilityBudgetLock(budgetPath, budgetBytes)
const receipt = JSON.parse(receiptBytes.toString('utf8')) as Receipt
const budget = JSON.parse(budgetBytes.toString('utf8')) as Budget
assert.equal(receipt.format, 'astrale.codegraph.maintainability-qualification')
assert.equal(receipt.version, 1)
assert.equal(budget.format, 'astrale.codegraph.maintainability-budget')
assert.equal(budget.version, 1)
assert.equal(receipt.budget.sha256, digest(budgetBytes))
const baselineBytes = await readFile(resolve(root, budget.baselineEvidence))
assert.equal(digest(baselineBytes), budget.baselineSha256)
assert.deepEqual(receipt.baseline, {
  revision: budget.baselineRevision,
  sha256: budget.baselineSha256,
})
const baselineDocument = JSON.parse(baselineBytes.toString('utf8')) as {
  readonly complexity: Baseline
}
const { receiptSha256: claimedDigest, ...body } = receipt
assert.equal(claimedDigest, digest(Buffer.from(stableJson(body))))

const measurement = await measureMaintainability(root)
assert.equal(stableJson(receipt.measurement), stableJson(measurement))
const violations = evaluate(measurement, baselineDocument.complexity, budget)
assert.deepEqual(receipt.violations, violations)
assert.equal(receipt.status, violations.length ? 'failed' : 'qualified')
const revision = (
  await execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
).stdout.trim()
const dirty = Boolean(
  (await execFile('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })).stdout.trim(),
)
assert.deepEqual(receipt.subject, { revision, dirty })

process.stdout.write(
  `${JSON.stringify({
    format: 'astrale.codegraph.maintainability-verification',
    version: 1,
    status: 'verified',
    receiptSha256: claimedDigest,
    recomputedPredicates: 12,
  }, null, 2)}\n`,
)

interface Receipt {
  readonly format: string
  readonly version: number
  readonly status: 'qualified' | 'failed'
  readonly subject: { readonly revision: string; readonly dirty: boolean }
  readonly baseline: { readonly revision: string; readonly sha256: string }
  readonly budget: { readonly sha256: string }
  readonly measurement: MaintainabilityMeasurement
  readonly violations: readonly string[]
  readonly receiptSha256: string
}

interface Budget {
  readonly format: string
  readonly version: number
  readonly baselineRevision: string
  readonly baselineEvidence: string
  readonly baselineSha256: string
  readonly maximumDelta: Record<string, number>
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
  compare(violations, 'files', current.files, baseline.files, limit(budget, 'files'))
  compare(
    violations,
    'directories',
    current.directories,
    baseline.directories,
    limit(budget, 'directories'),
  )
  compare(
    violations,
    'physicalLines',
    current.physicalLines,
    baseline.physicalLines,
    limit(budget, 'physicalLines'),
  )
  for (const band of ['over250', 'over500', 'over1000', 'over2000'] as const) {
    compare(
      violations,
      band,
      current.sizeBands[band],
      baseline.sizeBands[band],
      limit(budget, band),
    )
  }
  compare(
    violations,
    'relativeImportCycles',
    current.relativeImportCycles.length,
    baseline.relativeImportCycles.length,
    limit(budget, 'relativeImportCycles'),
  )
  compare(
    violations,
    'boundaryDefinitions',
    current.boundaryDefinitions,
    baseline.boundaryDefinitions,
    limit(budget, 'boundaryDefinitions'),
  )
  compare(
    violations,
    'repeatedBoundaryNames',
    current.repeatedBoundaryNames.length,
    baseline.repeatedBoundaryNames.length,
    limit(budget, 'repeatedBoundaryNames'),
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

function compare(
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

function limit(budget: Budget, name: string): number {
  const value = budget.maximumDelta[name]
  assert(Number.isSafeInteger(value) && value! >= 0, `Invalid budget limit ${name}.`)
  return value!
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

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  checkPerformanceViolations,
  completedCheckPhase,
  normalizedCheckArgv,
  semanticCheckResult,
  sha256,
  verifyCheckPerformanceReceipt,
  type CheckPerformanceReceipt,
} from './model.ts'
import {
  assertRatifiedPerformanceConstitution,
  CHECK_PERFORMANCE_CONSTITUTION,
  constitutedCheckArgv,
} from './constitution.ts'

const REQUIRED_SAMPLES = 100
const MINIMUM_RUNNERS = 2
const MINIMUM_REQUESTS = CHECK_PERFORMANCE_CONSTITUTION.check.workloads.length
const P95_TARGET_MILLISECONDS = 2_500
const MAXIMUM_LEAF_OWNERS = 25
const MINIMUM_DEPENDENCY_HEAVY_OWNERS = 100
const REQUIRED_WORKLOADS = [
  'whole',
  'leaf',
  'dependency-heavy',
  'multi-select',
  'valid',
  'diagnostic',
] as const

await assertRatifiedPerformanceConstitution()

const optimized = await receipts(requiredArgument('--receipts'))
const canonical = await receipts(requiredArgument('--canonical'))
assert.equal(optimized.length, REQUIRED_SAMPLES, `C1 requires exactly ${REQUIRED_SAMPLES} samples.`)
assert.ok(canonical.length >= MINIMUM_REQUESTS, 'Canonical request oracle is incomplete.')

const canonicalByRequest = new Map<string, CheckPerformanceReceipt>()
const workloadCoverage = new Set<string>()
const expectedRequests = new Map(CHECK_PERFORMANCE_CONSTITUTION.check.workloads.map((workload) => [
  stableJson(normalizedCheckArgv(constitutedCheckArgv('<corpus-root>', workload))),
  workload,
] as const))
for (const receipt of canonical) {
  verifyCheckPerformanceReceipt(receipt)
  assert.equal(receipt.version, 3, 'C1 canonical series qualification requires receipt v3.')
  assert.equal(receipt.subject.constitutionSha256, CHECK_PERFORMANCE_CONSTITUTION.sha256)
  assert.equal(
    receipt.subject.repositoryRevision,
    CHECK_PERFORMANCE_CONSTITUTION.corpus.revision,
  )
  assert.equal(receipt.class, 'C3')
  assert.equal(receipt.mode, 'canonical')
  const slow = completedCheckPhase(receipt, 'qualification.canonical-slow')
  assert.ok(slow, 'A canonical request receipt did not execute the owner-isolated compiler.')
  assert.equal(slow.metrics?.declarationPrograms, slow.metrics?.specificationOwners)
  assert.equal(slow.metrics?.modulePrograms, slow.metrics?.specificationOwners)
  const ownerMetric = slow.metrics?.specificationOwners
  assert.equal(typeof ownerMetric, 'number', 'Canonical owner count is missing.')
  const owners = ownerMetric as number
  const selectors = selectedArguments(receipt.request.argv)
  const key = requestKey(receipt)
  const constituted = expectedRequests.get(key)
  assert.ok(constituted, `Canonical request is outside the ratified constitution: ${key}.`)
  assert.equal(receipt.result.exitCode, constituted.expectedExitCode)
  if ('minimumOwners' in constituted) {
    assert.ok(
      owners >= constituted.minimumOwners,
      `${constituted.id} canonical owner count is below its ratified minimum.`,
    )
  }
  if ('maximumOwners' in constituted) {
    assert.ok(
      owners <= constituted.maximumOwners,
      `${constituted.id} canonical owner count exceeds its ratified maximum.`,
    )
  }
  workloadCoverage.add(constituted.id)
  if (!selectors.length) workloadCoverage.add('whole')
  if (selectors.length === 1 && owners <= MAXIMUM_LEAF_OWNERS) workloadCoverage.add('leaf')
  if (selectors.length === 1 && owners >= MINIMUM_DEPENDENCY_HEAVY_OWNERS) {
    workloadCoverage.add('dependency-heavy')
  }
  if (selectors.length >= 2) workloadCoverage.add('multi-select')
  if (receipt.result.exitCode === 0) workloadCoverage.add('valid')
  if (receipt.result.exitCode === 1) workloadCoverage.add('diagnostic')
  assert.ok(!canonicalByRequest.has(key), 'Canonical request oracle contains a duplicate shape.')
  canonicalByRequest.set(key, receipt)
}
assert.deepEqual(new Set(canonicalByRequest.keys()), new Set(expectedRequests.keys()))
for (const workload of REQUIRED_WORKLOADS) {
  assert.ok(workloadCoverage.has(workload), `Canonical request oracle lacks ${workload} coverage.`)
}

const violations: string[] = []
const runnerInstances = new Set<string>()
const processKeys = new Set<string>()
const runIds = new Set<string>()
const requestCounts = new Map<string, number>()
const hardware = new Set<string>()
for (const receipt of optimized) {
  verifyCheckPerformanceReceipt(receipt)
  assert.equal(receipt.version, 3, 'C1 series qualification requires receipt v3.')
  assert.equal(receipt.subject.constitutionSha256, CHECK_PERFORMANCE_CONSTITUTION.sha256)
  assert.equal(
    receipt.subject.repositoryRevision,
    CHECK_PERFORMANCE_CONSTITUTION.corpus.revision,
  )
  assert.equal(receipt.class, 'C1')
  assert.equal(receipt.mode, 'optimized')
  assert.ok(receipt.request.argv.includes('--no-cache'), 'C1 must disable mutable local caching.')
  assert.ok(receipt.series, 'C1 series evidence is missing.')
  const key = requestKey(receipt)
  const oracle = canonicalByRequest.get(key)
  assert.ok(oracle, `No canonical oracle exists for request ${key}.`)
  assert.deepEqual(semanticCheckResult(receipt), semanticCheckResult(oracle))
  assert.equal(receipt.subject.producerFingerprint, oracle.subject.producerFingerprint)
  assert.deepEqual(receipt.subject.sourceProof, oracle.subject.sourceProof)
  assert.deepEqual(
    [receipt.runner.node, receipt.runner.platform, receipt.runner.architecture,
      receipt.runner.codegraphRevision, receipt.runner.harnessSha256],
    [oracle.runner.node, oracle.runner.platform, oracle.runner.architecture,
      oracle.runner.codegraphRevision, oracle.runner.harnessSha256],
  )
  violations.push(
    ...checkPerformanceViolations(receipt).map(
      (violation) => `sample ${receipt.series!.sampleIndex}: ${violation}`,
    ),
  )
  runnerInstances.add(receipt.runner.instance!)
  runIds.add(receipt.series.runId)
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1)
  hardware.add(stableJson({
    node: receipt.runner.node,
    platform: receipt.runner.platform,
    architecture: receipt.runner.architecture,
    hardware: receipt.runner.hardware,
  }))
  const processKey = `${receipt.runner.instance}:${receipt.runner.processId}:${receipt.runner.startedAt}`
  assert.ok(!processKeys.has(processKey), 'C1 series reuses process evidence.')
  processKeys.add(processKey)
}

assert.equal(runIds.size, 1, 'C1 samples do not belong to one qualification run.')
assert.ok(runnerInstances.size >= MINIMUM_RUNNERS, 'C1 requires multiple fresh runners.')
assert.equal(hardware.size, 1, 'C1 runners do not share one qualified hardware class.')
assert.ok(requestCounts.size >= MINIMUM_REQUESTS, 'C1 request-shape coverage is incomplete.')
assert.deepEqual(new Set(requestCounts.keys()), new Set(canonicalByRequest.keys()))
const ordered = [...optimized].sort((left, right) => left.series!.sampleIndex - right.series!.sampleIndex)
assert.deepEqual(
  ordered.map((receipt) => receipt.series!.sampleIndex),
  Array.from({ length: REQUIRED_SAMPLES }, (_, index) => index),
  'C1 sample ordinals are not complete and unique.',
)
for (let index = 1; index < ordered.length; index += 1) {
  assert.notEqual(requestKey(ordered[index]!), requestKey(ordered[index - 1]!),
    'C1 request shapes were not interleaved.')
}
const counts = [...requestCounts.values()]
assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'C1 request shapes are not balanced.')
const durations = optimized.map((receipt) => receipt.resources.wallMilliseconds).sort((a, b) => a - b)
const p95Milliseconds = durations[Math.ceil(durations.length * 0.95) - 1]!
if (p95Milliseconds >= P95_TARGET_MILLISECONDS) {
  violations.push(`p95 ${round(p95Milliseconds)}ms is not below ${P95_TARGET_MILLISECONDS}ms`)
}

const body = {
  format: 'astrale.codegraph.check-performance-series-verification' as const,
  version: 1 as const,
  status: violations.length ? ('failed' as const) : ('qualified' as const),
  class: 'C1' as const,
  samples: optimized.length,
  runnerInstances: runnerInstances.size,
  requestShapes: requestCounts.size,
  workloads: [...workloadCoverage].sort(),
  processEvidence: processKeys.size,
  everyTargetMilliseconds: 3_000,
  p95TargetMilliseconds: P95_TARGET_MILLISECONDS,
  p95Milliseconds,
  maximumMilliseconds: Math.max(...durations),
  canonicalSetSha256: sha256(stableJson([...canonicalByRequest.values()].map(
    (receipt) => receipt.receiptSha256,
  ).sort())),
  constitutionSha256: CHECK_PERFORMANCE_CONSTITUTION.sha256,
  repositoryRevision: CHECK_PERFORMANCE_CONSTITUTION.corpus.revision,
  seriesSha256: sha256(stableJson(ordered.map((receipt) => ({
    sampleIndex: receipt.series!.sampleIndex,
    receiptSha256: receipt.receiptSha256,
  })))),
  violations: violations.sort(),
}
const verification = { ...body, verificationSha256: sha256(stableJson(body)) }
const serialized = `${JSON.stringify(verification, null, 2)}\n`
const output = argument('--output')
if (output) await writeFile(resolve(output), serialized, 'utf8')
process.stdout.write(serialized)
if (violations.length) process.exitCode = 1

async function receipts(directory: string): Promise<readonly CheckPerformanceReceipt[]> {
  const root = resolve(directory)
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort()
  return Promise.all(names.map(async (name) =>
    JSON.parse(await readFile(resolve(root, name), 'utf8')) as CheckPerformanceReceipt,
  ))
}

function requestKey(receipt: CheckPerformanceReceipt): string {
  return stableJson(normalizedCheckArgv(receipt.request.argv))
}

function selectedArguments(argv: readonly string[]): readonly string[] {
  const selected: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--select' && argv[index + 1]) selected.push(argv[++index]!)
  }
  return selected
}

function round(value: number): number {
  return Math.round(value * 100) / 100
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

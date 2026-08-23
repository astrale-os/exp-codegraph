import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  sha256,
  verifyCheckPerformanceReceipt,
  checkPerformanceTarget,
  checkPerformanceViolations,
  completedCheckPhase,
  normalizedCheckArgv,
  semanticCheckResult,
  type CheckPerformanceReceipt,
} from './model.ts'

const canonical = await receipt(requiredArgument('--canonical'))
const optimized = await receipt(requiredArgument('--optimized'))
verifyCheckPerformanceReceipt(canonical)
verifyCheckPerformanceReceipt(optimized)
assert.equal(canonical.mode, 'canonical')
assert.equal(optimized.mode, 'optimized')
assert.ok(
  canonical.class === optimized.class || canonical.class === 'C3',
  'A canonical receipt may be reused across start classes only from the source-only C3 oracle.',
)
assert.deepEqual(normalizedCheckArgv(canonical.request.argv), normalizedCheckArgv(optimized.request.argv))
const canonicalSlow = completedCheckPhase(canonical, 'qualification.canonical-slow')
assert.ok(canonicalSlow, 'Canonical receipt did not execute the owner-isolated slow compiler.')
assert.equal(canonicalSlow.metrics?.declarationPrograms, canonicalSlow.metrics?.specificationOwners)
assert.equal(canonicalSlow.metrics?.modulePrograms, canonicalSlow.metrics?.specificationOwners)
assert.equal(
  canonicalSlow.metrics?.specificationOwners,
  completedCheckPhase(canonical, 'application.compile')?.metrics?.specifications,
)
assert.deepEqual(semanticCheckResult(optimized), semanticCheckResult(canonical))
assert.equal(optimized.subject.producerFingerprint, canonical.subject.producerFingerprint)
assert.deepEqual(optimized.subject.sourceProof, canonical.subject.sourceProof)
assert.deepEqual(
  {
    node: optimized.runner.node,
    platform: optimized.runner.platform,
    architecture: optimized.runner.architecture,
    codegraphRevision: optimized.runner.codegraphRevision,
    harnessSha256: optimized.runner.harnessSha256,
  },
  {
    node: canonical.runner.node,
    platform: canonical.runner.platform,
    architecture: canonical.runner.architecture,
    codegraphRevision: canonical.runner.codegraphRevision,
    harnessSha256: canonical.runner.harnessSha256,
  },
)

const violations = checkPerformanceViolations(optimized)
const body = {
  format: 'astrale.codegraph.check-performance-verification' as const,
  version: 1 as const,
  status: violations.length ? ('failed' as const) : ('qualified' as const),
  class: optimized.class,
  semanticEquality: true,
  canonicalReceiptSha256: canonical.receiptSha256,
  optimizedReceiptSha256: optimized.receiptSha256,
  targetMilliseconds: checkPerformanceTarget(optimized.class),
  actualMilliseconds: optimized.resources.wallMilliseconds,
  violations,
}
const verification = { ...body, verificationSha256: sha256(stableJson(body)) }
const serialized = `${JSON.stringify(verification, null, 2)}\n`
const output = argument('--output')
if (output) await writeFile(resolve(output), serialized, 'utf8')
process.stdout.write(serialized)
if (violations.length) process.exitCode = 1

async function receipt(path: string): Promise<CheckPerformanceReceipt> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as CheckPerformanceReceipt
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

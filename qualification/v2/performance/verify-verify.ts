import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
  MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES,
} from './model.ts'

const receipt = JSON.parse(await readFile(resolve(requiredArgument('--receipt')), 'utf8')) as any
assert.equal(receipt.format, 'astrale.codegraph.verify-performance-receipt')
assert.equal(receipt.version, 1)
const { receiptSha256, ...body } = receipt
assert.equal(receiptSha256, digest(stableJson(body)))
assert.deepEqual(receipt.subject.sourceProofAfter, receipt.subject.sourceProofBefore)
assert.equal(receipt.start.analysisStore.exists, false)
assert.equal(receipt.result.failure, undefined)
assert.ok(receipt.result.refresh?.analysis, 'Verify receipt has no analysis generations.')
assert.deepEqual(receipt.result.refresh.capabilities, ['declaration-models'])
assert.deepEqual(receipt.result.refresh.analysisDiagnostics, [])
assert.ok(receipt.finish.analysisStore.exists, 'Verify did not materialize its analysis store.')
assert.ok(!receipt.result.stderr.includes('Invalid module fact'))
assert.ok(receipt.resources.maximumNativeResidentMiB > 0)
assert.ok(
  receipt.resources.maximumNativeResidentMiB * 1_024 * 1_024 <=
    MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
)
assert.ok(
  receipt.resources.maximumRssMiB * 1_024 * 1_024 <=
    MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES,
)
const selection = receipt.result.refresh.selection
assert.equal(selection.kind, receipt.class === 'V0' ? 'focused' : 'full')
const universes = receipt.result.inspection?.universes ?? []
const moduleUniverses = universes.filter((value: any) => value.modules > 0)
assert.ok(moduleUniverses.length > 0, 'Verify receipt inspected no module universe.')
assert.ok(moduleUniverses.every((value: any) => value.legacyModules === 0))
assert.ok(moduleUniverses.every((value: any) => value.declarations > 0))
assert.ok(moduleUniverses.every((value: any) => value.logicalModules === value.modules))
const transactionEvents = receipt.work.telemetry.filter(
  (event: any) =>
    (event.component === 'transport' && event.phase === 'request.roundtrip') ||
    (event.component === 'native' && event.phase === 'transport.serialize-and-write'),
)
const transactionBytes = transactionEvents.flatMap((event: any) =>
  typeof event.metrics?.transactionBytes === 'number' ? [event.metrics.transactionBytes] : [],
)
assert.ok(transactionBytes.length > 0, 'Verify receipt observed no streamed native transaction.')
const maximumTransactionBytes = Math.max(...transactionBytes)
assert.ok(maximumTransactionBytes < 384 * 1024 * 1024)
const verificationBody = {
  format: 'astrale.codegraph.verify-performance-verification' as const,
  version: 1 as const,
  status: 'qualified' as const,
  class: receipt.class,
  receiptSha256,
  wallMilliseconds: receipt.resources.wallMilliseconds,
  maximumRssMiB: receipt.resources.maximumRssMiB,
  maximumNativeResidentMiB: receipt.resources.maximumNativeResidentMiB,
  maximumTransactionBytes,
  moduleUniverses: moduleUniverses.length,
  modules: moduleUniverses.reduce((total: number, value: any) => total + value.modules, 0),
  declarations: moduleUniverses.reduce((total: number, value: any) => total + value.declarations, 0),
}
const verification = {
  ...verificationBody,
  verificationSha256: digest(stableJson(verificationBody)),
}
const serialized = `${JSON.stringify(verification, null, 2)}\n`
const output = argument('--output')
if (output) await writeFile(resolve(output), serialized, 'utf8')
process.stdout.write(serialized)

function digest(value: string): string {
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

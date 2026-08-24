import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  MAXIMUM_QUALIFIED_BINDING_WORKER_RESIDENT_BYTES,
  MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES,
} from './model.ts'

const receipt = JSON.parse(await readFile(resolve(requiredArgument('--receipt')), 'utf8')) as any
assert.equal(receipt.format, 'astrale.codegraph.verify-performance-receipt')
assert.equal(receipt.version, 2)
const { receiptSha256, ...body } = receipt
assert.equal(receiptSha256, digest(stableJson(body)))
assert.deepEqual(receipt.subject.sourceProofAfter, receipt.subject.sourceProofBefore)
assert.equal(receipt.start.analysisStore.exists, false)
assert.equal(receipt.result.failure, undefined)
assert.ok(receipt.result.refresh?.analysis, 'Verify receipt has no analysis generations.')
assert.deepEqual(receipt.result.refresh.capabilities, [])
assert.deepEqual(receipt.result.refresh.analysisDiagnostics, [])
assert.ok(receipt.finish.analysisStore.exists, 'Verify did not materialize its analysis store.')
assert.equal(receipt.resources.maximumNativeResidentMiB, 0)
assert.ok(receipt.resources.maximumBindingWorkerResidentMiB > 0)
assert.ok(
  receipt.resources.maximumCompilerWorkerResidentMiB * 1_024 * 1_024 <=
    MAXIMUM_QUALIFIED_BINDING_WORKER_RESIDENT_BYTES,
)
assert.equal(
  receipt.resources.maximumProcessTreeResidentUpperBoundMiB,
  receipt.resources.maximumRssMiB + receipt.resources.maximumCompilerWorkerResidentMiB,
)
assert.ok(
  receipt.resources.maximumRssMiB * 1_024 * 1_024 <=
    MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES,
)
const selection = receipt.result.refresh.selection
assert.equal(selection.kind, receipt.class === 'V0' ? 'focused' : 'full')
const universes = receipt.result.inspection?.universes ?? []
const bindingUniverses = universes.filter((value: any) => value.bindings > 0)
assert.ok(bindingUniverses.length > 0, 'Verify receipt inspected no binding universe.')
const nativeEvents = receipt.work.telemetry.filter(
  (event: any) =>
    (event.component === 'transport' && event.phase === 'request.roundtrip') ||
    (event.component === 'native' && event.phase === 'transport.serialize-and-write'),
)
assert.deepEqual(nativeEvents, [], 'Explicit binding verification started the legacy native path.')
const maximumBindingPayloadBytes = Math.max(
  ...bindingUniverses.map((value: any) => value.maximumBindingPayloadBytes),
)
assert.ok(maximumBindingPayloadBytes < 384 * 1024 * 1024)
const bindingWork = receipt.work.telemetry.find(
  (event: any) => event.component === 'analysis' && event.phase === 'application.module-bindings',
)
assert.ok(bindingWork, 'Verify receipt observed no compact binding compiler work.')
assert.ok(bindingWork.metrics?.programs > 0)
assert.ok(bindingWork.metrics?.sourceFiles > 0)
const verificationBody = {
  format: 'astrale.codegraph.verify-performance-verification' as const,
  version: 1 as const,
  status: 'qualified' as const,
  class: receipt.class,
  receiptSha256,
  wallMilliseconds: receipt.resources.wallMilliseconds,
  maximumRssMiB: receipt.resources.maximumRssMiB,
  maximumNativeResidentMiB: 0,
  maximumBindingWorkerResidentMiB: receipt.resources.maximumBindingWorkerResidentMiB,
  maximumCompilerWorkerResidentMiB: receipt.resources.maximumCompilerWorkerResidentMiB,
  maximumProcessTreeResidentUpperBoundMiB:
    receipt.resources.maximumProcessTreeResidentUpperBoundMiB,
  maximumBindingPayloadBytes,
  bindingUniverses: bindingUniverses.length,
  bindings: bindingUniverses.reduce((total: number, value: any) => total + value.bindings, 0),
  programs: bindingWork.metrics.programs,
  sourceFiles: bindingWork.metrics.sourceFiles,
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

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES,
} from './model.ts'

const incrementalPaths = argumentValues('--incremental')
assert.ok(incrementalPaths.length >= 3, 'V2 requires at least three independent resident samples.')
const incrementals = await Promise.all(incrementalPaths.map(receipt))
const cold = await receipt(requiredArgument('--cold'))
assert.equal(cold.format, 'astrale.codegraph.verify-performance-receipt')
assert.equal(cold.class, 'V0')

const samples = incrementals.map((incremental: any) => verifySample(incremental, cold))
const walls = samples.map((sample) => sample.wallMilliseconds).sort((left, right) => left - right)
const medianWallMilliseconds = walls[Math.floor(walls.length / 2)]!
const maximumWallMilliseconds = Math.max(...walls)
assert.ok(maximumWallMilliseconds < 5_000, 'V2 resident maximum must remain below 5 seconds.')
assert.ok(medianWallMilliseconds < 3_000, 'V2 resident median must remain below 3 seconds.')
const body = {
  format: 'astrale.codegraph.verify-incremental-verification' as const,
  version: 3 as const,
  status: 'qualified' as const,
  incrementalReceiptSha256: incrementals.map((value: any) => value.receiptSha256),
  coldReceiptSha256: cold.receiptSha256,
  semanticEquality: true,
  sampleWallMilliseconds: samples.map((sample) => sample.wallMilliseconds),
  medianWallMilliseconds,
  maximumWallMilliseconds,
  immediateMaximumMilliseconds: 5_000,
  targetMedianMilliseconds: 3_000,
  upsertShards: samples.map((sample) => sample.upsertShards),
  bindingPrograms: samples.map((sample) => sample.bindingPrograms),
}
const verification = { ...body, verificationSha256: digest(stableJson(body)) }
const serialized = `${JSON.stringify(verification, null, 2)}\n`
const output = argument('--output')
if (output) await writeFile(resolve(output), serialized, 'utf8')
process.stdout.write(serialized)

function verifySample(incremental: any, oracle: any) {
  assert.equal(incremental.format, 'astrale.codegraph.verify-incremental-receipt')
  assert.equal(incremental.class, 'V2')
  assert.deepEqual(incremental.subject.dirtyProof, incremental.subject.proofAfter)
  assert.deepEqual(incremental.subject.dirtyProof, oracle.subject.sourceProofBefore)
  assert.deepEqual(oracle.subject.sourceProofBefore, oracle.subject.sourceProofAfter)
  assert.deepEqual(semanticRefresh(incremental.delta.refresh), semanticRefresh(oracle.result.refresh))
  assert.deepEqual(incremental.delta.inspection, oracle.result.inspection)
  assert.deepEqual(incremental.delta.refresh.analysisDiagnostics, [])
  assert.equal(incremental.delta.resources.maximumNativeResidentMiB, 0)
  assert.ok(
    incremental.delta.resources.maximumRssMiB * 1_024 * 1_024 <=
      MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES,
  )
  const nativeEvents = incremental.delta.telemetry.filter((event: any) =>
    (event.component === 'transport' && event.phase === 'request.roundtrip') ||
    (event.component === 'native' && event.phase === 'transport.serialize-and-write'),
  )
  assert.deepEqual(nativeEvents, [], 'V2 delta started the legacy native verifier.')
  const bindingWork = incremental.delta.telemetry.find(
    (event: any) => event.component === 'analysis' && event.phase === 'application.module-bindings',
  )
  assert.ok(bindingWork?.metrics?.programs > 0, 'V2 emitted no affected binding compiler work.')
  const upsertShards = incremental.delta.telemetry
    .filter((event: any) => event.component === 'sqlite-store' && event.phase === 'transaction.commit-total')
    .reduce((total: number, event: any) => total + Number(event.metrics?.upsertShards ?? 0), 0)
  const coldBindings = oracle.result.inspection.universes.reduce(
    (total: number, value: any) => total + value.bindings,
    0,
  )
  assert.ok(upsertShards > 0 && upsertShards < coldBindings)
  return {
    wallMilliseconds: incremental.delta.wallMilliseconds as number,
    upsertShards,
    bindingPrograms: bindingWork.metrics.programs as number,
  }
}

async function receipt(path: string): Promise<any> {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'))
  const { receiptSha256, ...body } = value
  assert.equal(receiptSha256, digest(stableJson(body)))
  return value
}

function semanticRefresh(value: any) {
  const { timing: _timing, changes: _changes, ...semantic } = value
  return semantic
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function argumentValues(name: string): readonly string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] ? [process.argv[index + 1]!] : [],
  )
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

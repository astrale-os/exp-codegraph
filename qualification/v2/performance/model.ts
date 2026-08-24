import { createHash } from 'node:crypto'

import type { AnalysisTelemetryEvent } from '../../../analysis/index.ts'
import type {
  CliAccelerationEvent,
  CliAccelerationReceipt,
} from '../../../cli/acceleration.ts'
import type { CliResult } from '../../../cli/run.ts'
import type { SourceProofAdmission } from '../../../repository/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'

export type PerformanceClass = 'C0' | 'C1' | 'C2' | 'C3'
export type PerformanceMode = 'canonical' | 'optimized'

/** Qualification must fail visibly before one native compiler can pressure ordinary CI hosts. */
export const MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES = 768 * 1_024 * 1_024
export const MAXIMUM_QUALIFIED_BINDING_WORKER_RESIDENT_BYTES = 768 * 1_024 * 1_024
export const MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES = 1_024 * 1_024 * 1_024

export interface DirectoryEvidence {
  readonly exists: boolean
  readonly files: number
  readonly bytes: number
}

export interface CheckPerformanceCounters {
  readonly bytesTraversed: number
  readonly bytesRead: number
  readonly bytesHashed: number
  readonly bytesDecoded: number
  readonly bytesWritten: number
  readonly compilerSessions: number
  readonly compilerPrograms: number
  readonly compiledOwners: number
  readonly observedOwners: number
  readonly qualifiedOwners: number
  readonly loadedShards: number
  readonly writtenShards: number
  readonly fallbacks: number
  readonly timedPhases: number
}

export interface CheckPerformanceReceiptBody {
  readonly format: 'astrale.codegraph.check-performance-receipt'
  readonly version: 1 | 2 | 3
  readonly class: PerformanceClass
  readonly mode: PerformanceMode
  readonly request: { readonly argv: readonly string[] }
  readonly runner: {
    readonly node: string
    readonly platform: NodeJS.Platform
    readonly architecture: string
    readonly codegraphRevision: string
    readonly harnessSha256: string
    readonly processId?: number
    readonly startedAt?: string
    readonly instance?: string
    readonly hardware?: {
      readonly cpuModel: string
      readonly logicalCpus: number
      readonly availableParallelism: number
      readonly totalMemoryBytes: number
    }
  }
  readonly series?: { readonly runId: string; readonly sampleIndex: number }
  readonly subject: {
    readonly producerFingerprint: string
    readonly sourceProof: SourceProofAdmission
    readonly repositoryRevision?: string
    readonly constitutionSha256?: string
  }
  readonly start: {
    readonly ci: boolean
    readonly localCache: DirectoryEvidence
    readonly semanticPack?: DirectoryEvidence
  }
  readonly result: {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly stdoutSha256: string
    readonly stderrSha256: string
    readonly check?: Pick<NonNullable<CliResult['check']>, 'repository' | 'inventory' | 'snapshot'>
    readonly acceleration?: CliAccelerationReceipt
    readonly failure?: { readonly name: string; readonly message: string; readonly code?: string }
  }
  readonly work: {
    readonly telemetry: readonly AnalysisTelemetryEvent[]
    readonly counters?: CheckPerformanceCounters
  }
  readonly resources: {
    readonly wallMilliseconds: number
    readonly userCpuMilliseconds: number
    readonly systemCpuMilliseconds: number
    readonly maximumRssMiB: number
    readonly maximumNativeResidentMiB: number
    readonly maximumWorkerResidentUpperBoundMiB: number
    readonly maximumProcessTreeResidentUpperBoundMiB: number
  }
  readonly finish: {
    readonly localCache: DirectoryEvidence
    readonly semanticPack?: DirectoryEvidence
  }
}

export function maximumNativeResidentMiB(
  telemetry: readonly AnalysisTelemetryEvent[],
): number {
  const bytes = telemetry.flatMap((event) =>
    event.component === 'transport' &&
    event.phase === 'process.resources' &&
    typeof event.metrics?.peakResidentBytes === 'number'
      ? [event.metrics.peakResidentBytes]
      : [],
  )
  return bytes.length ? Math.max(...bytes) / 1_024 / 1_024 : 0
}

export function maximumBindingWorkerResidentMiB(
  telemetry: readonly AnalysisTelemetryEvent[],
): number {
  const bytes = telemetry.flatMap((event) => {
    const value = event.phase === 'application.module-bindings'
      ? event.metrics?.workerResidentUpperBoundBytes
      : undefined
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? [value] : []
  })
  return bytes.length ? Math.max(...bytes) / 1_024 / 1_024 : 0
}

export function maximumWorkerResidentUpperBoundMiB(
  telemetry: readonly AnalysisTelemetryEvent[],
): number {
  const bytes = telemetry.flatMap((event) => {
    const value = event.metrics?.workerResidentUpperBoundBytes
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? [value] : []
  })
  return bytes.length ? Math.max(...bytes) / 1_024 / 1_024 : 0
}

export function maximumWorkerProcessTreeUpperBoundMiB(
  telemetry: readonly AnalysisTelemetryEvent[],
): number {
  const bytes = telemetry.flatMap((event) => {
    const parent = event.metrics?.parentPeakResidentBytes
    const workers = event.metrics?.workerResidentUpperBoundBytes
    return typeof parent === 'number' &&
      Number.isSafeInteger(parent) &&
      parent >= 0 &&
      typeof workers === 'number' &&
      Number.isSafeInteger(workers) &&
      workers >= 0
      ? [parent + workers]
      : []
  })
  return bytes.length ? Math.max(...bytes) / 1_024 / 1_024 : 0
}

export type CheckPerformanceReceipt = CheckPerformanceReceiptBody & {
  readonly receiptSha256: string
}

export function createCheckPerformanceReceipt(
  body: CheckPerformanceReceiptBody,
): CheckPerformanceReceipt {
  return { ...body, receiptSha256: sha256(stableJson(body)) }
}

export function verifyCheckPerformanceReceipt(receipt: CheckPerformanceReceipt): void {
  const { receiptSha256, ...body } = receipt
  if (receiptSha256 !== sha256(stableJson(body))) {
    throw new Error('Check performance receipt digest is invalid.')
  }
  if (
    receipt.format !== 'astrale.codegraph.check-performance-receipt' ||
    ![1, 2, 3].includes(receipt.version) ||
    !['C0', 'C1', 'C2', 'C3'].includes(receipt.class) ||
    !['canonical', 'optimized'].includes(receipt.mode)
  ) {
    throw new Error('Check performance receipt contract is invalid.')
  }
  if (
    !Array.isArray(receipt.work.telemetry) ||
    ![
      receipt.resources.wallMilliseconds,
      receipt.resources.userCpuMilliseconds,
      receipt.resources.systemCpuMilliseconds,
      receipt.resources.maximumRssMiB,
      receipt.resources.maximumNativeResidentMiB,
      receipt.resources.maximumWorkerResidentUpperBoundMiB,
      receipt.resources.maximumProcessTreeResidentUpperBoundMiB,
    ].every(finiteNonnegative)
  ) {
    throw new Error('Check performance resource evidence is invalid.')
  }
  if (
    receipt.version === 2 &&
    (
      !Number.isSafeInteger(receipt.runner.processId) ||
      receipt.runner.processId! < 1 ||
      typeof receipt.runner.startedAt !== 'string' ||
      Number.isNaN(Date.parse(receipt.runner.startedAt)) ||
      typeof receipt.runner.instance !== 'string' ||
      !receipt.runner.instance ||
      !receipt.runner.hardware ||
      typeof receipt.runner.hardware.cpuModel !== 'string' ||
      !receipt.runner.hardware.cpuModel ||
      !Number.isSafeInteger(receipt.runner.hardware.logicalCpus) ||
      receipt.runner.hardware.logicalCpus < 1 ||
      !Number.isSafeInteger(receipt.runner.hardware.availableParallelism) ||
      receipt.runner.hardware.availableParallelism < 1 ||
      !Number.isSafeInteger(receipt.runner.hardware.totalMemoryBytes) ||
      receipt.runner.hardware.totalMemoryBytes < 1 ||
      (receipt.series !== undefined &&
        (!receipt.series.runId ||
          !Number.isSafeInteger(receipt.series.sampleIndex) ||
          receipt.series.sampleIndex < 0))
    )
  ) {
    throw new Error('Check performance v2 process evidence is invalid.')
  }
  if (
    receipt.version === 3 &&
    (
      typeof receipt.subject.repositoryRevision !== 'string' ||
      !/^[0-9a-f]{40}$/u.test(receipt.subject.repositoryRevision) ||
      typeof receipt.subject.constitutionSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(receipt.subject.constitutionSha256) ||
      !validPerformanceCounters(receipt.work.counters)
    )
  ) {
    throw new Error('Check performance v3 constitution evidence is invalid.')
  }
  if (
    receipt.version === 3 &&
    stableJson(receipt.work.counters) !== stableJson(
      deriveCheckPerformanceCounters(receipt.work.telemetry, receipt.result.acceleration),
    )
  ) {
    throw new Error('Check performance v3 derived work counters are invalid.')
  }
  if (
    receipt.version === 3 &&
    Math.abs(receipt.resources.maximumProcessTreeResidentUpperBoundMiB - Math.max(
      receipt.resources.maximumRssMiB,
      maximumWorkerProcessTreeUpperBoundMiB(receipt.work.telemetry),
      receipt.resources.maximumRssMiB + receipt.resources.maximumNativeResidentMiB,
    )) > 1e-9
  ) {
    throw new Error('Check performance v3 process-tree memory bound is invalid.')
  }
  if (receipt.result.stdoutSha256 !== sha256(receipt.result.stdout)) {
    throw new Error('Check performance receipt stdout digest is invalid.')
  }
  if (receipt.result.stderrSha256 !== sha256(receipt.result.stderr)) {
    throw new Error('Check performance receipt stderr digest is invalid.')
  }
}

export function deriveCheckPerformanceCounters(
  telemetry: readonly AnalysisTelemetryEvent[],
  acceleration: CliAccelerationReceipt | undefined,
): CheckPerformanceCounters {
  const completed = telemetry.filter((event) => event.metrics?.status === 'completed')
  const accelerationEvents = acceleration?.events ?? []
  const canonical = completed.find((event) => event.phase === 'qualification.canonical-slow')
  const compilerPhases = completed.filter((event) => event.phase.startsWith('application.compile.'))
  const inventoryPhases = completed.filter((event) =>
    event.phase === 'application.inventory.git' ||
    event.phase === 'qualification.canonical-inventory' ||
    event.phase === 'qualification.source-proof',
  )
  const checkpoints = completed.filter((event) => event.phase === 'application.checkpoint')
  const compile = completed.find((event) => event.phase === 'application.compile')
  const observation = completed.find((event) => event.phase === 'application.analysis')
  const qualification = completed.find((event) => event.phase === 'application.qualification')
  const accelerationWork = accelerationEvents.flatMap((event) => event.work ? [event.work] : [])
  const canonicalOwners = metric(canonical, 'specificationOwners')
  return {
    bytesTraversed: sumMetrics(inventoryPhases, 'bytesTraversed'),
    bytesRead:
      sumMetrics(inventoryPhases, 'bytesRead') + sumWork(accelerationWork, 'bytesRead'),
    bytesHashed: sumMetrics(inventoryPhases, 'bytesHashed'),
    bytesDecoded:
      sumMetrics(checkpoints, 'checkpointDecodedBytes') +
      sumWork(accelerationWork, 'bytesDecoded'),
    bytesWritten: sumWork(accelerationWork, 'bytesWritten'),
    compilerSessions:
      sumMetrics(compilerPhases, 'sessions') +
      metric(canonical, 'declarationSessions') +
      metric(canonical, 'moduleSessions'),
    compilerPrograms:
      sumMetrics(compilerPhases, 'programs') +
      metric(canonical, 'declarationPrograms') +
      metric(canonical, 'modulePrograms'),
    compiledOwners: metric(compile, 'specifications') || canonicalOwners,
    observedOwners: metric(observation, 'observedSpecifications') || canonicalOwners,
    qualifiedOwners: metric(qualification, 'specifications') || canonicalOwners,
    loadedShards:
      sumMetrics(checkpoints, 'checkpointArtifacts') +
      sumWork(accelerationWork, 'loadedShards'),
    writtenShards: sumWork(accelerationWork, 'writtenShards'),
    fallbacks:
      sumMetrics(compilerPhases, 'fallbacks') +
      inventoryPhases.filter((event) => event.metrics?.outcome === 'fallback').length +
      accelerationEvents.filter((event) => event.outcome === 'fallback').length,
    timedPhases:
      telemetry.filter((event) => finiteNonnegative(event.durationNs)).length +
      accelerationEvents.filter((event) => finiteNonnegative(event.durationMs)).length,
  }
}

export function semanticCheckResult(receipt: CheckPerformanceReceipt): unknown {
  return {
    exitCode: receipt.result.exitCode,
    stdout: receipt.result.stdout,
    stderr: receipt.result.stderr,
    check: receipt.result.check,
    failure: receipt.result.failure,
  }
}

export function normalizedCheckArgv(argv: readonly string[]): readonly string[] {
  const normalized = argv.filter((argument) => argument !== '--no-cache')
  return normalized.map((argument, index) =>
    index === 1 && normalized[0] === 'check' ? '<corpus-root>' : argument,
  )
}

export function completedCheckPhase(receipt: CheckPerformanceReceipt, phase: string) {
  return [...receipt.work.telemetry]
    .reverse()
    .find(
      (event) =>
        event.component === 'analysis' &&
        event.phase === phase &&
        event.metrics?.status === 'completed',
    )
}

export function checkPerformanceViolations(
  receipt: CheckPerformanceReceipt,
): readonly string[] {
  const violations: string[] = []
  const counters = receipt.work.counters
  if (!counters) {
    violations.push('receipt has no independently derived work counters')
  } else if (counters.timedPhases < 1) {
    violations.push('receipt has no timed causal phase')
  }
  if (receipt.resources.wallMilliseconds >= checkPerformanceTarget(receipt.class)) {
    violations.push(
      `wall ${round(receipt.resources.wallMilliseconds)}ms is not below ${checkPerformanceTarget(receipt.class)}ms`,
    )
  }
  if (receipt.resources.maximumRssMiB * 1_024 * 1_024 > MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES) {
    violations.push(
      `runner resident peak ${round(receipt.resources.maximumRssMiB)}MiB exceeds the qualified limit`,
    )
  }
  if (
    receipt.resources.maximumProcessTreeResidentUpperBoundMiB * 1_024 * 1_024 >
    MAXIMUM_QUALIFIED_RUNNER_RESIDENT_BYTES
  ) {
    violations.push(
      `process-tree resident upper bound ${round(receipt.resources.maximumProcessTreeResidentUpperBoundMiB)}MiB exceeds the qualified limit`,
    )
  }
  if (
    receipt.resources.maximumNativeResidentMiB * 1_024 * 1_024 >
    MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES
  ) {
    violations.push(
      `native resident peak ${round(receipt.resources.maximumNativeResidentMiB)}MiB exceeds the qualified limit`,
    )
  }
  const events = receipt.result.acceleration?.events ?? []
  switch (receipt.class) {
    case 'C0':
      if (!events.some((event) => event.outcome === 'hit')) {
        violations.push('C0 has no admitted replay hit')
      }
      replayCounterViolations('C0', counters, violations)
      break
    case 'C1':
      if (!receipt.start.ci) violations.push('C1 did not run with CI=true')
      if (receipt.start.localCache.files !== 0) violations.push('C1 local cache was not empty')
      if (receipt.finish.localCache.files !== 0) violations.push('C1 wrote its local cache')
      if (!receipt.start.semanticPack?.files) violations.push('C1 semantic pack was absent')
      if (
        !events.some(
          (event) => event.operation === 'semantic-pack-read' && event.outcome === 'hit',
        )
      ) {
        violations.push('C1 did not admit a semantic pack')
      }
      if (receipt.work.telemetry.length) {
        violations.push('C1 executed canonical application work after pack admission')
      }
      if (stableJson(receipt.start.semanticPack) !== stableJson(receipt.finish.semanticPack)) {
        violations.push('C1 mutated its supplied semantic pack')
      }
      replayCounterViolations('C1', counters, violations)
      break
    case 'C2': {
      if (counters?.compiledOwners !== 1) {
        violations.push('C2 did not compile exactly one specification owner')
      }
      if (counters?.observedOwners !== 1) {
        violations.push('C2 did not observe exactly one specification owner')
      }
      if (counters?.qualifiedOwners !== 1) {
        violations.push('C2 did not qualify exactly one specification owner')
      }
      sourceCompilerCounterViolations('C2', counters, violations)
      break
    }
    case 'C3':
      if (receipt.start.localCache.files !== 0) violations.push('C3 local cache was not empty')
      if (receipt.finish.localCache.files !== 0) violations.push('C3 wrote its local cache')
      if (events.some((event) => event.outcome === 'hit')) {
        violations.push('C3 used a replay or pack hit')
      }
      if (!completedCheckPhase(receipt, 'application.compile')) {
        violations.push('C3 observed no canonical application work')
      }
      sourceCompilerCounterViolations('C3', counters, violations)
      if (receipt.resources.maximumWorkerResidentUpperBoundMiB <= 0) {
        violations.push('C3 did not report declaration-worker peak residency')
      }
      break
  }
  return violations.sort()
}

function replayCounterViolations(
  name: 'C0' | 'C1',
  counters: CheckPerformanceCounters | undefined,
  violations: string[],
): void {
  if (!counters) return
  if (counters.loadedShards < 1 || counters.bytesRead < 1 || counters.bytesDecoded < 1) {
    violations.push(`${name} did not count its admitted shard bytes`)
  }
  if (
    counters.compilerSessions !== 0 ||
    counters.compilerPrograms !== 0 ||
    counters.compiledOwners !== 0 ||
    counters.observedOwners !== 0 ||
    counters.qualifiedOwners !== 0
  ) {
    violations.push(`${name} performed or claimed canonical compiler work`)
  }
}

function sourceCompilerCounterViolations(
  name: 'C2' | 'C3',
  counters: CheckPerformanceCounters | undefined,
  violations: string[],
): void {
  if (!counters) return
  if (
    counters.bytesTraversed < 1 ||
    counters.bytesRead < 1 ||
    counters.bytesHashed < 1
  ) {
    violations.push(`${name} did not count source admission bytes`)
  }
  if (counters.compilerSessions < 1 || counters.compilerPrograms < 1) {
    violations.push(`${name} did not count compiler sessions and programs`)
  }
  if (
    counters.compiledOwners < 1 ||
    counters.observedOwners < 1 ||
    counters.qualifiedOwners < 1
  ) {
    violations.push(`${name} did not count compiled, observed, and qualified owners`)
  }
}

export function checkPerformanceTarget(value: PerformanceClass): number {
  return value === 'C0' ? 1_000 : 3_000
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function metric(
  event: AnalysisTelemetryEvent | undefined,
  name: string,
): number {
  const value = event?.metrics?.[name]
  return finiteNonnegative(value) ? value : 0
}

function sumMetrics(events: readonly AnalysisTelemetryEvent[], name: string): number {
  return events.reduce((total, event) => total + metric(event, name), 0)
}

function sumWork(
  values: readonly NonNullable<CliAccelerationEvent['work']>[],
  name: keyof NonNullable<CliAccelerationEvent['work']>,
): number {
  return values.reduce((total, value) => {
    const current = value[name]
    return total + (finiteNonnegative(current) ? current : 0)
  }, 0)
}

function validPerformanceCounters(
  value: CheckPerformanceCounters | undefined,
): value is CheckPerformanceCounters {
  if (!value) return false
  return Object.values(value).every(
    (counter) => Number.isSafeInteger(counter) && counter >= 0,
  )
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

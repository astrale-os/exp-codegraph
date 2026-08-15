import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { AnalysisTelemetryEvent } from '../../../analysis/index.ts'
import { createNodeTypeSpecApplicationService } from '../../../application/node/index.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from '../../../application/limits.ts'

const root = resolve(requiredArgument('--root'))
const native = resolve(requiredArgument('--native-binary'))
const revision = requiredArgument('--revision')
const output = resolve(requiredArgument('--output'))
const selected = argument('--select') ?? 'core'
const affectedEvidencePath = resolve(
  argument('--affected-evidence') ?? '.history/v2/evidence/affected-shard-qualification.json',
)
const cache = await mkdtemp(join(tmpdir(), 'codegraph-application-qualification-'))
const events: AnalysisTelemetryEvent[] = []

try {
  const service = await createNodeTypeSpecApplicationService({
    root,
    cacheDirectory: cache,
    persistence: 'advisory',
    native: { binary: native },
    telemetry: (event) => events.push(event),
  })
  try {
    const cold = await service.refresh({ qualify: true, compilerAnalysis: true })
    assertAuthoritative(cold.snapshot)
    const coldMemory = memoryMeasurement()
    const audit = qualificationAudit(cold.snapshot.qualifications)
    const diagnosticOutput = argument('--diagnostic-output')
    if (diagnosticOutput) {
      await writeFile(resolve(diagnosticOutput), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
    }
    const warm = await service.refresh({ qualify: true, compilerAnalysis: true })
    assertAuthoritative(warm.snapshot)
    const warmMemory = memoryMeasurement()
    assert.equal(warm.snapshot.id, cold.snapshot.id)
    assert.deepEqual(warm.changes.specifications, { added: [], changed: [], removed: [] })
    assert.deepEqual(warm.changes.sources, [])
    assert.deepEqual(warm.changes.invalidatedPasses, [])

    const focused = await service.refresh({
      qualify: true,
      compilerAnalysis: false,
      focused: true,
      select: [selected],
    })
    assert.equal(focused.snapshot.selection.kind, 'focused')
    assert(focused.snapshot.qualifications.length > 0, 'Focused qualification selected no owners.')
    assertAuthoritative(focused.snapshot)
    const focusedMemory = memoryMeasurement()

    const sqliteFile = join(cache, 'analysis-v2.sqlite')
    const sqliteBytes = (await stat(sqliteFile)).size
    const nativeStartupMs = maximumDuration(events, 'native', 'compiler.open')
    assert(nativeStartupMs !== undefined, 'Native startup telemetry was not observed.')
    const maximumRssMiB = focusedMemory.maximumRssMiB
    const affected = JSON.parse(await readFile(affectedEvidencePath, 'utf8')) as {
      readonly status?: unknown
      readonly kernel?: {
        readonly incrementalMs?: unknown
        readonly speedup?: unknown
        readonly exactColdEquality?: unknown
      }
    }
    assert.equal(affected.status, 'qualified')
    assert.equal(affected.kernel?.exactColdEquality, true)
    assert.equal(typeof affected.kernel?.incrementalMs, 'number')
    assert.equal(typeof affected.kernel?.speedup, 'number')

    const limits = TYPE_SPEC_APPLICATION_LIMITS
    const measurements = {
      coldFullMs: round(cold.timing.totalMs),
      warmFullMs: round(warm.timing.totalMs),
      focusedSelectionMs: round(focused.timing.totalMs),
      affectedPrivateEditMs: affected.kernel.incrementalMs,
      affectedPrivateEditSpeedup: affected.kernel.speedup,
      nativeStartupMs: round(nativeStartupMs),
      sqliteBytes,
      maximumRssMiB: round(maximumRssMiB),
      rssByPhase: {
        cold: coldMemory,
        warm: warmMemory,
        focused: focusedMemory,
      },
    }
    const violations = [
      limitViolation('warm full check', measurements.warmFullMs, limits.maximumWarmFullCheckMilliseconds),
      limitViolation('focused check', measurements.focusedSelectionMs, limits.maximumFocusedCheckMilliseconds),
      limitViolation('native startup', measurements.nativeStartupMs, limits.maximumNativeStartupMilliseconds),
      limitViolation('SQLite size', sqliteBytes, limits.maximumSQLiteBytes),
      limitViolation('interactive RSS', maximumRssMiB, limits.maximumInteractiveHeapMiB),
      limitViolation(
        'affected private edit',
        affected.kernel.incrementalMs as number,
        limits.maximumFocusedCheckMilliseconds,
      ),
    ].filter((value): value is string => Boolean(value))
    if (violations.length) {
      const diagnostic = `${output}.diagnostic.json`
      await writeFile(diagnostic, `${JSON.stringify({
        format: 'astrale.codegraph.v2.application-cut-diagnostic-measurements',
        version: 1,
        status: 'diagnostic-only',
        measurements,
        limits,
        violations,
      }, null, 2)}\n`, 'utf8')
      assert.fail(`Application qualification limits failed: ${violations.join('; ')}. Diagnostic: ${diagnostic}`)
    }

    const result = {
      format: 'astrale.codegraph.v2.application-cut-qualification',
      version: 1,
      status: 'qualified',
      qualifiedRequirements: [
        'V2-APP-001',
        'V2-APP-002',
        'V2-APP-003',
        'V2-APP-004',
        'V2-APP-005',
        'V2-CON-004',
        'V2-SEC-004',
        'V2-QLF-007',
      ],
      corpus: {
        revision,
        specifications: cold.snapshot.specifications.length,
        specificationSources: cold.snapshot.specifications.map((value) => value.source).sort(),
        inventory: cold.snapshot.inventory,
        application: cold.snapshot.id,
        analysis: cold.snapshot.analysis,
        qualifications: statusCounts(cold.snapshot.qualifications.map((value) => value.status)),
        qualificationOutcomes: cold.snapshot.qualifications.map((value) => ({
          source: value.specification.source,
          id: value.id,
          status: value.status,
        })),
        qualificationFingerprints: audit.summary.fingerprints,
      },
      measurements,
      limits,
      observations: {
        coldReferenceExceeded:
          measurements.coldFullMs > limits.maximumColdFullCheckMilliseconds,
      },
      invariants: {
        coldAndWarmApplicationIdentityEqual: true,
        warmChangedSources: 0,
        warmInvalidatedPasses: 0,
        inventoryPinnedAnalysis: true,
        allSpecificationsQualified:
          cold.snapshot.qualifications.length === cold.snapshot.specifications.length,
        reportedNonPassQualifications: audit.nonPass.length,
        diagnostics: 0,
        affectedIncrementalEqualsCold: true,
      },
      provenance: {
        nativeSha256: digest(await readFile(native)),
        affectedEvidenceSha256: digest(await readFile(affectedEvidencePath)),
        command:
          'node qualification/v2/application/qualify.ts --root <kernel> --native-binary <binary> --revision <revision> --select core --output <evidence>',
      },
    }
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify({
      format: result.format,
      status: result.status,
      specifications: result.corpus.specifications,
      measurements: result.measurements,
      output,
    }, null, 2)}\n`)
  } finally {
    await service.dispose()
  }
} finally {
  await rm(cache, { recursive: true, force: true })
}

function assertAuthoritative(
  snapshot: import('../../../application/index.ts').TypeSpecApplicationSnapshot,
): void {
  assert(snapshot.specifications.length > 0, 'Application corpus is empty.')
  assert(snapshot.analysis, 'Application qualification omitted its analysis snapshot set.')
  assert.equal(snapshot.analysis.inventory, snapshot.inventory)
  assert.equal(
    snapshot.diagnostics.length,
    0,
    `Application diagnostics: ${JSON.stringify(snapshot.diagnostics.slice(0, 20))}`,
  )
  assert.equal(
    snapshot.analysisDiagnostics.length,
    0,
    `Application analysis diagnostics: ${JSON.stringify(snapshot.analysisDiagnostics.slice(0, 20))}`,
  )
  assert(snapshot.qualifications.length > 0, 'Application qualification produced no results.')
}

function qualificationAudit(
  qualifications: readonly import('../../../conformance/index.ts').QualificationSnapshot[],
) {
  const nonPass = qualifications
    .filter((qualification) => qualification.status !== 'pass')
    .map((qualification) => ({
      source: qualification.specification.source,
      status: qualification.status,
      profiles: qualification.profiles
        .filter((profile) => profile.status !== 'pass')
        .map((profile) => ({
          id: profile.id,
          status: profile.status,
          diagnostics: profile.rules.flatMap((rule) =>
            rule.diagnostics.map((diagnostic) => ({ ...diagnostic })),
          ),
        })),
    }))
  const fingerprints: Record<string, number> = {}
  for (const qualification of nonPass) {
    for (const profile of qualification.profiles) {
      if (!profile.diagnostics.length) {
        const key = `${qualification.status}\0${profile.id}\0<no-diagnostic>`
        fingerprints[key] = (fingerprints[key] ?? 0) + 1
      }
      for (const diagnostic of profile.diagnostics) {
        const key = `${qualification.status}\0${profile.id}\0${diagnostic.code}`
        fingerprints[key] = (fingerprints[key] ?? 0) + 1
      }
    }
  }
  return {
    format: 'astrale.codegraph.v2.application-cut-diagnostic',
    version: 1,
    summary: {
      qualifications: statusCounts(qualifications.map((value) => value.status)),
      fingerprints: Object.fromEntries(Object.entries(fingerprints).sort(([left], [right]) => left.localeCompare(right))),
    },
    nonPass,
  }
}

function maximumDuration(
  events: readonly AnalysisTelemetryEvent[],
  component: AnalysisTelemetryEvent['component'],
  phase: string,
): number | undefined {
  const durations = events
    .filter((event) => event.component === component && event.phase === phase)
    .flatMap((event) => event.durationNs === undefined ? [] : [event.durationNs / 1_000_000])
  return durations.length ? Math.max(...durations) : undefined
}

function statusCounts(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`Missing required ${name}.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function memoryMeasurement(): { readonly currentRssMiB: number; readonly maximumRssMiB: number } {
  return {
    currentRssMiB: round(process.memoryUsage().rss / (1024 * 1024)),
    maximumRssMiB: round(process.resourceUsage().maxRSS / 1_024),
  }
}

function limitViolation(name: string, actual: number, maximum: number): string | undefined {
  return actual > maximum ? `${name} ${round(actual)} exceeded governed maximum ${maximum}` : undefined
}

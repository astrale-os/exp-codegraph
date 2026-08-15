import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const codegraphPath = resolve(requiredArgument('--codegraph'))
const kernelPath = resolve(requiredArgument('--kernel'))
const adversarialPath = resolve(requiredArgument('--adversarial'))
const coldBaselinePath = resolve(requiredArgument('--cold-baseline'))
const coldCandidatePath = resolve(requiredArgument('--cold-candidate'))
const nativePath = resolve(requiredArgument('--native-binary'))
const kernelRevision = requiredArgument('--kernel-revision')
const output = resolve(requiredArgument('--output'))

const codegraph = await readJson<AffectedProjectResult>(codegraphPath)
const kernel = await readJson<AffectedProjectResult>(kernelPath)
const adversarial = await readJson<AdversarialResult>(adversarialPath)
const coldBaseline = await readJson<ColdResult>(coldBaselinePath)
const coldCandidate = await readJson<ColdResult>(coldCandidatePath)

qualifyProject(codegraph, 'codegraph')
qualifyProject(kernel, 'kernel')
assert.equal(adversarial.format, 'astrale.codegraph.affected-shards-experiment')
assert.equal(adversarial.exactColdEquality, true)
assert.deepEqual(
  adversarial.results.map((result) => result.name).sort(),
  [
    'ambient-scope',
    'commit-replay',
    'computed-dependency',
    'config',
    'create',
    'delete',
    'import-graph',
    'private-body',
    'private-diagnostic',
    'public-shape',
    'rename',
  ],
)
assert(adversarial.results.every((result) => result.exactColdEquality))
assert.equal(coldBaseline.format, 'astrale.codegraph.cold-project-attribution')
assert.equal(coldCandidate.format, 'astrale.codegraph.cold-project-attribution')
assert(
  coldCandidate.elapsedMs <= coldBaseline.elapsedMs * 1.05,
  `Candidate cold path regressed: ${coldCandidate.elapsedMs} > ${coldBaseline.elapsedMs * 1.05}`,
)

const coldBaselineProjection = event(coldBaseline, 'projection.total')
const coldCandidateProjection = event(coldCandidate, 'projection.total')
const coldBaselineTransport = event(coldBaseline, 'transport.serialize-and-write')
const coldCandidateTransport = event(coldCandidate, 'transport.serialize-and-write')
const result = {
  format: 'astrale.codegraph.v2.affected-shard-qualification',
  version: 1,
  status: 'qualified',
  qualifiedRequirements: ['V2-ANA-014'],
  contributesToRequirements: ['V2-QLF-006'],
  thresholds: {
    minimumPrivateEditSpeedup: 20,
    maximumColdRegression: 0.05,
    incrementalEqualsIndependentCold: true,
    changedPayloadRowsOnly: true,
  },
  codegraph: projectEvidence(codegraph),
  kernel: projectEvidence(kernel),
  coldAttribution: {
    sourceManifestIdentityComparable: false,
    sourceManifestIdentityReason:
      'The historical producer predates the candidate identity preimage and is performance attribution only.',
    baselineMs: coldBaseline.elapsedMs,
    candidateMs: coldCandidate.elapsedMs,
    candidateOverBaseline: round(coldCandidate.elapsedMs / coldBaseline.elapsedMs),
    baselineProjectionNs: coldBaselineProjection.durationNs,
    candidateProjectionNs: coldCandidateProjection.durationNs,
    baselineTransportNs: coldBaselineTransport.durationNs,
    candidateTransportNs: coldCandidateTransport.durationNs,
    baselineTransactionBytes: numberMetric(coldBaselineTransport, 'transactionBytes'),
    candidateTransactionBytes: numberMetric(coldCandidateTransport, 'transactionBytes'),
  },
  adversarial: adversarial.results.map((scenario) => ({
    name: scenario.name,
    exactColdEquality: scenario.exactColdEquality,
    ...(scenario.mode ? { mode: scenario.mode } : {}),
    ...(scenario.projectedSources !== undefined
      ? { projectedSources: scenario.projectedSources }
      : {}),
    ...(scenario.projectedModules !== undefined
      ? { projectedModules: scenario.projectedModules }
      : {}),
  })),
  provenance: {
    kernelRevision,
    nativeSha256: await digest(nativePath),
    artifacts: {
      codegraph: await artifact(codegraphPath),
      kernel: await artifact(kernelPath),
      adversarial: await artifact(adversarialPath),
      coldBaseline: await artifact(coldBaselinePath),
      coldCandidate: await artifact(coldCandidatePath),
    },
    commands: [
      'node qualification/v2/experiments/affected-shards.ts --native-binary <binary> --output <artifact>',
      'node qualification/v2/experiments/affected-project.ts --target codegraph --root . --native-binary <binary> --backend sqlite --project tsconfig.json --changed analysis/generation/model.ts --output <artifact>',
      'node qualification/v2/experiments/affected-project.ts --target kernel --root <clean-kernel> --native-binary <binary> --backend sqlite --project core/tsconfig.json --changed core/dns-label.ts --output <artifact>',
    ],
  },
}

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({
  format: result.format,
  status: result.status,
  codegraphSpeedup: result.codegraph.speedup,
  kernelSpeedup: result.kernel.speedup,
  coldCandidateOverBaseline: result.coldAttribution.candidateOverBaseline,
  output,
}, null, 2)}\n`)

function qualifyProject(value: AffectedProjectResult, target: 'codegraph' | 'kernel'): void {
  assert.equal(value.format, 'astrale.codegraph.affected-project-experiment')
  assert.equal(value.target, target)
  assert.equal(value.backend, 'sqlite')
  assert.equal(value.nativePublication, 'commit-late')
  assert.equal(value.exactColdEquality, true)
  assert(value.speedup >= 20, `${target} speedup ${value.speedup} is below 20x.`)
  assert.equal(value.sourcesProjected, 1)
  assert.equal(value.native?.changedPaths, 1)
  assert.equal(value.sqliteAttribution.delta.generations, 1)
  assert.equal(value.sqliteAttribution.delta.shardRows, value.upsertShards)
  assert.equal(value.sqliteAttribution.delta.factRows, value.upsertFacts)
  assert.equal(value.sqliteAttribution.delta.payloadRows, value.upsertShards)
  assert.equal(value.sqliteAttribution.delta.membershipRows, value.manifestShards)
}

function projectEvidence(value: AffectedProjectResult) {
  return {
    project: value.project,
    changed: value.changed,
    incrementalMs: value.incrementalMs,
    independentColdMs: value.coldMs,
    speedup: value.speedup,
    exactColdEquality: value.exactColdEquality,
    sourcesProjected: value.sourcesProjected,
    manifestShards: value.manifestShards,
    upsertShards: value.upsertShards,
    upsertFacts: value.upsertFacts,
    deleteShards: value.deleteShards,
    wireBytes: value.nativeWire.wireBytes,
    transactionBytes: value.nativeWire.transactionBytes,
    nativeAllocatedBytes: value.native.totalAllocatedBytes,
    sqliteCommitNs: value.sqlitePhases['transaction.commit-total']?.durationNs,
    sqliteRows: value.sqliteAttribution.delta,
  }
}

function event(value: ColdResult, phase: string): TelemetryEvent {
  const found = value.events.find((candidate) =>
    candidate.component === 'native' && candidate.phase === phase)
  if (!found) throw new Error(`Cold artifact omitted ${phase}.`)
  return found
}

function numberMetric(value: TelemetryEvent, key: string): number {
  const metric = value.metrics?.[key]
  if (typeof metric !== 'number') throw new Error(`${value.phase} omitted numeric ${key}.`)
  return metric
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function artifact(path: string) {
  return { sha256: await digest(path) }
}

async function digest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
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
  return Math.round(value * 1_000_000) / 1_000_000
}

interface TelemetryEvent {
  readonly component: string
  readonly phase: string
  readonly durationNs?: number
  readonly metrics?: Readonly<Record<string, string | number | boolean>>
}

interface ColdResult {
  readonly format: string
  readonly elapsedMs: number
  readonly sourceManifest: unknown
  readonly events: readonly TelemetryEvent[]
}

interface AffectedProjectResult {
  readonly format: string
  readonly target: string
  readonly backend: string
  readonly project: string
  readonly changed: string
  readonly nativePublication: string
  readonly sourcesProjected: number
  readonly incrementalMs: number
  readonly coldMs: number
  readonly speedup: number
  readonly manifestShards: number
  readonly upsertShards: number
  readonly upsertFacts: number
  readonly deleteShards: number
  readonly exactColdEquality: boolean
  readonly nativeWire: { readonly wireBytes: number; readonly transactionBytes: number }
  readonly native: { readonly changedPaths: number; readonly totalAllocatedBytes: number }
  readonly sqlitePhases: Readonly<Record<string, { readonly durationNs?: number }>>
  readonly sqliteAttribution: {
    readonly delta: {
      readonly generations: number
      readonly shardRows: number
      readonly factRows: number
      readonly payloadRows: number
      readonly membershipRows: number
    }
  }
}

interface AdversarialResult {
  readonly format: string
  readonly exactColdEquality: boolean
  readonly results: readonly {
    readonly name: string
    readonly exactColdEquality: boolean
    readonly mode?: string
    readonly projectedSources?: number
    readonly projectedModules?: number
  }[]
}

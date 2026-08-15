import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const affectedProject = resolve(dirname(new URL(import.meta.url).pathname), 'affected-project.ts')
const target = requiredTarget(argument('--target') ?? 'codegraph')
const root = resolve(requiredArgument('--root'))
const output = resolve(requiredArgument('--output'))
const baselineBinary = resolve(requiredArgument('--baseline-binary'))
const candidateBinary = resolve(requiredArgument('--candidate-binary'))
const project = argument('--project') ?? 'tsconfig.json'
const changed = argument('--changed')
const backend = requiredBackend(argument('--backend') ?? 'sqlite')
const blocks = positiveInteger(argument('--blocks') ?? '6', '--blocks')
const warmups = positiveInteger(argument('--warmups') ?? '1', '--warmups')
const runDirectory = `${output}.runs`
await mkdir(runDirectory, { recursive: true })

const binaries = {
  baseline: baselineBinary,
  candidate: candidateBinary,
} as const
type Condition = keyof typeof binaries

const analyzerTree = await digestTree(process.cwd())
const analyzerGit = await gitState(process.cwd())
const corpusTree = await digestTree(root)
const corpusGit = await gitState(root)
const binaryIdentities = {
  baseline: await binaryIdentity(baselineBinary),
  candidate: await binaryIdentity(candidateBinary),
}

const samples: Sample[] = []
for (let block = -warmups; block < blocks; block++) {
  const warmup = block < 0
  const order: readonly Condition[] = (block + warmups) % 2 === 0
    ? ['baseline', 'candidate']
    : ['candidate', 'baseline']
  for (const [position, condition] of order.entries()) {
    const label = `${warmup ? `warmup-${block + warmups + 1}` : `block-${block + 1}`}-${position + 1}-${condition}`
    process.stderr.write(`[affected-matrix] ${label}\n`)
    const sample = await run(condition, warmup, block, position, join(runDirectory, `${label}.json`))
    samples.push(sample)
    process.stderr.write(
      `[affected-matrix] ${label} incremental=${sample.result.incrementalMs}ms cold=${sample.result.coldMs}ms rss=${sample.processTreePeakRssKiB}KiB\n`,
    )
  }
}

const measured = samples.filter((sample) => !sample.warmup)
assert(measured.length === blocks * 2, 'Every measured block must contain both conditions.')
assert.deepEqual(await digestTree(process.cwd()), analyzerTree, 'Analyzer tree changed during the matrix.')
assert.deepEqual(await digestTree(root), corpusTree, 'Corpus tree changed during the matrix.')
assert.deepEqual(
  {
    baseline: await binaryIdentity(baselineBinary),
    candidate: await binaryIdentity(candidateBinary),
  },
  binaryIdentities,
  'A native binary changed during the matrix.',
)
assertExactSemantics(measured)
const incremental = compare(measured, (sample) => sample.result.incrementalMs)
const cold = compare(measured, (sample) => sample.result.coldMs)
const processTreeRss = compare(measured, (sample) => sample.processTreePeakRssKiB)
const wire = compareOptional(measured, (sample) => numeric(sample.result.nativeWire?.wireBytes))
const transaction = compareOptional(
  measured,
  (sample) => numeric(sample.result.nativeWire?.transactionBytes),
)
const allocation = compareOptional(
  measured,
  (sample) => numeric(sample.result.native?.totalAllocatedBytes),
)
const candidateRows = measured
  .filter((sample) => sample.condition === 'candidate' && sample.result.sqliteAttribution)
  .map((sample) => {
    const delta = sample.result.sqliteAttribution!.delta
    return {
      block: sample.block + 1,
      upsertShards: sample.result.upsertShards,
      upsertFacts: sample.result.upsertFacts,
      manifestShards: sample.result.manifestShards,
      delta,
      changedPayloadsOnly:
        delta.payloadRows === sample.result.upsertShards &&
        delta.factRows === sample.result.upsertFacts &&
        delta.membershipRows === sample.result.manifestShards,
    }
  })

const result = {
  format: 'astrale.codegraph.affected-matrix',
  version: 1,
  target,
  project,
  changed: changed ?? null,
  backend,
  blocks,
  warmups,
  method: {
    order: 'counterbalanced-two-condition-blocks',
    rssSamplingMs: 250,
    statistics: 'paired median ratio, MAD, deterministic paired bootstrap 95% interval',
    semanticOracle: 'each incremental result equals an independent cold rebuild; paired conditions share one generation',
  },
  environment: {
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    totalMemoryBytes: totalmem(),
  },
  analyzer: {
    tree: analyzerTree,
    git: analyzerGit,
  },
  corpus: {
    tree: corpusTree,
    git: corpusGit,
  },
  binaries: binaryIdentities,
  samples,
  comparisons: { incremental, cold, processTreeRss, wire, transaction, allocation },
  sqliteCandidateRows: candidateRows,
  gates: {
    exactColdEquality: measured.every((sample) => sample.result.exactColdEquality),
    pairedSemanticEquality: true,
    privateEditSpeedup20x: incremental.baselineOverCandidate >= 20,
    coldMedianRegressionAtMost5Percent: cold.candidateOverBaseline <= 1.05,
    changedPayloadsOnly:
      backend !== 'sqlite' ||
      (candidateRows.length === blocks && candidateRows.every((row) => row.changedPayloadsOnly)),
  },
}
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({
  format: result.format,
  version: result.version,
  target: result.target,
  comparisons: result.comparisons,
  gates: result.gates,
  output,
}, null, 2)}\n`)

async function run(
  condition: Condition,
  warmup: boolean,
  block: number,
  position: number,
  artifact: string,
): Promise<Sample> {
  const arguments_ = [
    affectedProject,
    '--target', target,
    '--root', root,
    '--native-binary', binaries[condition],
    '--backend', backend,
    '--project', project,
    ...(condition === 'baseline' ? ['--legacy-native'] : []),
    ...(changed ? ['--changed', changed] : []),
  ]
  const started = performance.now()
  const child = spawn(process.execPath, arguments_, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout = boundedAppend(stdout, chunk) })
  child.stderr.on('data', (chunk: string) => { stderr = boundedAppend(stderr, chunk) })
  const rss = sampleProcessTree(child.pid!, 250)
  const exit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    },
  )
  const memory = await rss.stop()
  if (exit.code !== 0) {
    throw new Error(
      `Affected ${condition} failed code=${String(exit.code)} signal=${String(exit.signal)}\n${stderr}\n${stdout}`,
    )
  }
  assert(memory.totalPeakKiB > 0 && memory.rootPeakKiB > 0, 'RSS sampling produced no observations.')
  const parsed = JSON.parse(stdout) as AffectedResult
  assert.equal(parsed.target, target)
  assert.equal(parsed.backend, backend)
  assert.equal(parsed.exactColdEquality, true)
  const bytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`)
  await writeFile(artifact, bytes)
  return {
    condition,
    warmup,
    block,
    position,
    artifact: relative(dirname(output), artifact).replaceAll('\\', '/'),
    artifactSha256: sha256(bytes),
    wallMs: round(performance.now() - started),
    processTreePeakRssKiB: memory.totalPeakKiB,
    nodePeakRssKiB: memory.rootPeakKiB,
    descendantPeakRssKiB: memory.descendantPeakKiB,
    result: parsed,
  }
}

function assertExactSemantics(samples: readonly Sample[]): void {
  const byBlock = grouped(samples)
  for (const [block, values] of byBlock) {
    const baseline = values.get('baseline')
    const candidate = values.get('candidate')
    assert(baseline && candidate, `Block ${block + 1} is incomplete.`)
    assert.equal(
      candidate.result.generation,
      baseline.result.generation,
      `Block ${block + 1} baseline and candidate generations differ.`,
    )
  }
}

function compare(samples: readonly Sample[], select: (sample: Sample) => number) {
  const pairs = [...grouped(samples)]
    .sort(([left], [right]) => left - right)
    .map(([block, values]) => ({
      block: block + 1,
      baseline: select(values.get('baseline')!),
      candidate: select(values.get('candidate')!),
    }))
  return summarizeRatios(pairs)
}

function compareOptional(samples: readonly Sample[], select: (sample: Sample) => number | undefined) {
  const pairs = [...grouped(samples)]
    .sort(([left], [right]) => left - right)
    .flatMap(([block, values]) => {
      const baseline = select(values.get('baseline')!)
      const candidate = select(values.get('candidate')!)
      return baseline === undefined || candidate === undefined
        ? []
        : [{ block: block + 1, baseline, candidate }]
    })
  return pairs.length ? summarizeRatios(pairs) : null
}

function grouped(samples: readonly Sample[]): Map<number, Map<Condition, Sample>> {
  const result = new Map<number, Map<Condition, Sample>>()
  for (const sample of samples) {
    const values = result.get(sample.block) ?? new Map<Condition, Sample>()
    values.set(sample.condition, sample)
    result.set(sample.block, values)
  }
  return result
}

function summarizeRatios(
  pairs: readonly { readonly block: number; readonly baseline: number; readonly candidate: number }[],
) {
  const ratios = pairs.map((pair) => pair.candidate / pair.baseline)
  const medianRatio = median(ratios)
  return {
    pairs,
    candidateOverBaseline: round(medianRatio, 6),
    baselineOverCandidate: round(1 / medianRatio, 6),
    medianAbsoluteDeviation: round(
      median(ratios.map((ratio) => Math.abs(ratio - medianRatio))),
      6,
    ),
    bootstrap95: bootstrapMedianInterval(ratios, 10_000),
  }
}

function bootstrapMedianInterval(values: readonly number[], iterations: number) {
  let state = 0x5eed_2026
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
  const medians: number[] = []
  for (let iteration = 0; iteration < iterations; iteration++) {
    medians.push(median(Array.from(
      { length: values.length },
      () => values[Math.floor(next() * values.length)]!,
    )))
  }
  medians.sort((left, right) => left - right)
  return {
    lower: round(medians[Math.floor(iterations * 0.025)]!, 6),
    upper: round(medians[Math.min(iterations - 1, Math.ceil(iterations * 0.975))]!, 6),
  }
}

function median(values: readonly number[]): number {
  assert(values.length, 'A median requires at least one observation.')
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function sampleProcessTree(pid: number, intervalMs: number) {
  let sampling = false
  let rootPeakKiB = 0
  let descendantPeakKiB = 0
  let totalPeakKiB = 0
  const sample = async (): Promise<void> => {
    if (sampling) return
    sampling = true
    try {
      const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss='], {
        maxBuffer: 8 * 1_024 * 1_024,
      })
      const rows = stdout.trim().split('\n')
        .map((line) => line.trim().split(/\s+/u).map(Number))
        .filter((row) => row.length === 3 && row.every(Number.isFinite)) as [number, number, number][]
      const descendants = new Set([pid])
      let changed = true
      while (changed) {
        changed = false
        for (const [child, parent] of rows) {
          if (descendants.has(parent) && !descendants.has(child)) {
            descendants.add(child)
            changed = true
          }
        }
      }
      const root = rows.find(([candidate]) => candidate === pid)?.[2] ?? 0
      const total = rows
        .filter(([candidate]) => descendants.has(candidate))
        .reduce((sum, row) => sum + row[2], 0)
      rootPeakKiB = Math.max(rootPeakKiB, root)
      descendantPeakKiB = Math.max(descendantPeakKiB, total - root)
      totalPeakKiB = Math.max(totalPeakKiB, total)
    } catch {
      // Diagnostic attribution cannot alter the benchmark result.
    } finally {
      sampling = false
    }
  }
  void sample()
  const timer = setInterval(() => void sample(), intervalMs)
  timer.unref()
  return {
    async stop() {
      clearInterval(timer)
      await sample()
      return { rootPeakKiB, descendantPeakKiB, totalPeakKiB }
    },
  }
}

async function digestTree(rootPath: string): Promise<{ readonly digest: string; readonly files: number }> {
  const hash = createHash('sha256')
  let files = 0
  const excluded = new Set(['.cache', '.git', 'coverage', 'dist', 'evidence', 'node_modules'])
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue
      const path = join(directory, entry.name)
      const portable = relative(rootPath, path).replaceAll('\\', '/')
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        const value = await readFile(path)
        hash.update(`file\0${portable}\0${value.byteLength}\0`).update(value)
        files++
      } else if (entry.isSymbolicLink()) {
        hash.update(`link\0${portable}\0${await readlink(path)}\0`)
        files++
      }
    }
  }
  await visit(rootPath)
  return { digest: hash.digest('hex'), files }
}

async function gitState(rootPath: string) {
  try {
    const [{ stdout: revision }, { stdout: status }, { stdout: diff }] = await Promise.all([
      execute('git', ['-C', rootPath, 'rev-parse', 'HEAD']),
      execute('git', ['-C', rootPath, 'status', '--short']),
      execute('git', ['-C', rootPath, 'diff', '--binary', 'HEAD'], { maxBuffer: 64 * 1_024 * 1_024 }),
    ])
    return {
      revision: revision.trim(),
      dirty: Boolean(status.trim()),
      status: status.trim().split('\n').filter(Boolean),
      trackedDiffSha256: sha256(Buffer.from(diff)),
    }
  } catch {
    return null
  }
}

async function binaryIdentity(path: string) {
  const bytes = await readFile(path)
  const buildPath = resolve(dirname(path), '..', 'build.json')
  let build: unknown = null
  try { build = JSON.parse(await readFile(buildPath, 'utf8')) } catch {}
  return { sha256: sha256(bytes), build }
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function boundedAppend(current: string, chunk: string): string {
  const next = current + chunk
  return next.length <= 256 * 1_024 ? next : next.slice(-256 * 1_024)
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function round(value: number, places = 2): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
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

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive.`)
  return parsed
}

function requiredTarget(value: string): 'codegraph' | 'kernel' {
  if (value !== 'codegraph' && value !== 'kernel') throw new Error('--target must be codegraph or kernel.')
  return value
}

function requiredBackend(value: string): 'memory' | 'sqlite' {
  if (value !== 'memory' && value !== 'sqlite') throw new Error('--backend must be memory or sqlite.')
  return value
}

interface AffectedResult {
  readonly target: 'codegraph' | 'kernel'
  readonly backend: 'memory' | 'sqlite'
  readonly incrementalMs: number
  readonly coldMs: number
  readonly generation: string
  readonly manifestShards: number
  readonly upsertShards: number
  readonly upsertFacts: number
  readonly exactColdEquality: boolean
  readonly nativeWire?: Readonly<Record<string, string | number | boolean>>
  readonly native?: Readonly<Record<string, string | number | boolean>>
  readonly sqliteAttribution?: {
    readonly delta: {
      readonly generations: number
      readonly shardRows: number
      readonly factRows: number
      readonly payloadRows: number
      readonly membershipRows: number
    }
  }
}

interface Sample {
  readonly condition: Condition
  readonly warmup: boolean
  readonly block: number
  readonly position: number
  readonly artifact: string
  readonly artifactSha256: string
  readonly wallMs: number
  readonly processTreePeakRssKiB: number
  readonly nodePeakRssKiB: number
  readonly descendantPeakRssKiB: number
  readonly result: AffectedResult
}

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  writeFile,
} from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const profileProject = resolve(
  dirname(new URL(import.meta.url).pathname),
  'profile-project.ts',
)
const target = requiredTarget(argument('--target') ?? 'codegraph')
const root = resolve(requiredArgument('--root'))
const nativeBinary = resolve(requiredArgument('--native-binary'))
const output = resolve(requiredArgument('--output'))
const project = argument('--project')
const blocks = positiveInteger(argument('--blocks') ?? '6', '--blocks')
const warmups = positiveInteger(argument('--warmups') ?? '1', '--warmups')
const runDirectory = `${output}.runs`
await mkdir(runDirectory, { recursive: true })

const conditions = {
  'semantic-inline': { compact: false, materialization: 'inline-json' },
  'compact-inline': { compact: true, materialization: 'inline-json' },
  'semantic-shard': { compact: false, materialization: 'shard-brotli' },
  'compact-shard': { compact: true, materialization: 'shard-brotli' },
} as const
type ConditionId = keyof typeof conditions

const orders: readonly (readonly ConditionId[])[] = [
  ['semantic-inline', 'compact-inline', 'semantic-shard', 'compact-shard'],
  ['compact-shard', 'semantic-shard', 'compact-inline', 'semantic-inline'],
  ['semantic-shard', 'compact-shard', 'semantic-inline', 'compact-inline'],
  ['compact-inline', 'semantic-inline', 'compact-shard', 'semantic-shard'],
]

const analyzerTree = await digestTree(process.cwd())
const nativeDigest = sha256(await readFile(nativeBinary))
const sourceState = await gitState(process.cwd())
const nativeBuild = await optionalJson(resolve(dirname(nativeBinary), '..', 'build.json'))
const samples: RunSample[] = []

for (let block = -warmups; block < blocks; block++) {
  const warmup = block < 0
  const order = orders[((block + warmups) % orders.length + orders.length) % orders.length]!
  for (const [position, condition] of order.entries()) {
    const label = `${warmup ? `warmup-${block + warmups + 1}` : `block-${block + 1}`}-${position + 1}-${condition}`
    const artifact = join(runDirectory, `${label}.json`)
    process.stderr.write(`[matrix] ${label}\n`)
    const sample = await runCondition(condition, artifact, warmup, block, position)
    samples.push(sample)
    process.stderr.write(
      `[matrix] ${label} cold=${sample.metrics.coldMs}ms db=${sample.metrics.sqliteBytes} rss=${sample.metrics.processTreePeakRssKiB}KiB\n`,
    )
  }
}

const measured = samples.filter((sample) => !sample.warmup)
assertSemanticEquivalence(measured)
const comparisons = {
  bodyWithinInline: comparePairs(measured, 'semantic-inline', 'compact-inline'),
  bodyWithinShard: comparePairs(measured, 'semantic-shard', 'compact-shard'),
  storageWithinSemantic: comparePairs(measured, 'semantic-inline', 'semantic-shard'),
  storageWithinCompact: comparePairs(measured, 'compact-inline', 'compact-shard'),
  endToEnd: comparePairs(measured, 'semantic-inline', 'compact-shard'),
}
const result = {
  format: 'astrale.codegraph.experiment-matrix',
  version: 1,
  target,
  root,
  project: project ?? null,
  blocks,
  warmups,
  method: {
    order: 'counterbalanced-four-condition-blocks',
    rssSamplingMs: 250,
    statistics: 'paired median ratio, MAD, deterministic paired bootstrap 95% interval',
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
    treeDigest: analyzerTree.digest,
    files: analyzerTree.files,
    git: sourceState,
  },
  native: {
    sha256: nativeDigest,
    build: nativeBuild,
  },
  samples,
  comparisons,
}
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({
  format: result.format,
  version: result.version,
  target: result.target,
  blocks: result.blocks,
  analyzer: result.analyzer,
  native: { sha256: result.native.sha256 },
  comparisons: result.comparisons,
  output,
}, null, 2)}\n`)

async function runCondition(
  condition: ConditionId,
  artifact: string,
  warmup: boolean,
  block: number,
  position: number,
): Promise<RunSample> {
  const selected = conditions[condition]
  const arguments_ = [
    profileProject,
    '--target', target,
    '--root', root,
    '--native-binary', nativeBinary,
    '--backend', 'sqlite',
    '--materialization', selected.materialization,
    '--output', artifact,
    ...(project ? ['--project', project] : []),
    ...(selected.compact ? ['--compact'] : []),
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
  child.stdout.on('data', (chunk: string) => {
    stdout = boundedAppend(stdout, chunk)
  })
  child.stderr.on('data', (chunk: string) => {
    stderr = boundedAppend(stderr, chunk)
  })
  const rss = sampleProcessTree(child.pid!, 250)
  const exit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    },
  )
  const memory = await rss.stop()
  assert(
    memory.totalPeakKiB > 0 && memory.rootPeakKiB > 0,
    'Process-tree RSS sampling produced no observations.',
  )
  if (exit.code !== 0) {
    throw new Error(
      `Profile ${condition} failed code=${String(exit.code)} signal=${String(exit.signal)}\n${stderr}\n${stdout}`,
    )
  }
  const bytes = await readFile(artifact)
  const profile = JSON.parse(bytes.toString('utf8')) as ProjectProfile
  assert.equal(profile.native, nativeDigest)
  assert.equal(profile.compact, selected.compact)
  assert.equal(profile.payloadMaterialization, selected.materialization)
  assert.equal(profile.projects.length, 1, 'A matrix run must select exactly one compiler project.')
  const observed = profile.projects[0]!
  return {
    condition,
    warmup,
    block,
    position,
    artifact,
    artifactSha256: sha256(bytes),
    wallMs: round(performance.now() - started),
    identity: {
      generation: observed.generation,
      universe: observed.universe,
      sourceManifest: observed.sourceManifest,
      semanticDigest: observed.semanticDigest,
      boundFactDigest: observed.boundFactDigest,
      manifestDigest: observed.manifestDigest,
      facts: observed.facts,
    },
    metrics: {
      coldMs: observed.sqliteMs,
      sqliteBytes: profile.sqliteBytes,
      processTreePeakRssKiB: memory.totalPeakKiB,
      nodePeakRssKiB: memory.rootPeakKiB,
      descendantPeakRssKiB: memory.descendantPeakKiB,
      semanticFactBytes: observed.factBytes,
      semanticBodyBytes: observed.namespaceBytes['typescript.body'] ?? 0,
      physicalBodyBytes: nativeNamespaceBytes(profile, 'typescript.body'),
      transactionBytes: nativeMetric(profile, 'transport.serialize-and-write', 'transactionBytes'),
      wireBytes: nativeMetric(profile, 'transport.serialize-and-write', 'wireBytes'),
      nativeAllocatedBytes: nativeMetric(profile, 'refresh.total', 'totalAllocatedBytes'),
      nativeHeapBytes: nativeMetric(profile, 'refresh.total', 'heapBytes'),
      nativeSystemBytes: nativeMetric(profile, 'refresh.total', 'systemBytes'),
      semanticPayloadBytes: nativeMetric(profile, 'facts.semantic-payloads', 'bytes'),
      query: observed.queryWorkloads,
      sqliteAttribution: profile.sqliteAttribution,
      physicalBodyFields: nativeBodyFields(profile),
    },
  }
}

function assertSemanticEquivalence(samples: readonly RunSample[]): void {
  const expected = JSON.stringify(samples[0]?.identity)
  assert(expected, 'No measured matrix samples were produced.')
  for (const sample of samples) {
    assert.equal(
      JSON.stringify(sample.identity),
      expected,
      `Semantic output differs for ${sample.condition} block ${sample.block + 1}.`,
    )
  }
}

function comparePairs(
  samples: readonly RunSample[],
  baseline: ConditionId,
  candidate: ConditionId,
) {
  const byBlock = new Map<number, Map<ConditionId, RunSample>>()
  for (const sample of samples) {
    const values = byBlock.get(sample.block) ?? new Map<ConditionId, RunSample>()
    values.set(sample.condition, sample)
    byBlock.set(sample.block, values)
  }
  const metricNames: readonly ScalarMetric[] = [
    'coldMs',
    'sqliteBytes',
    'processTreePeakRssKiB',
    'nodePeakRssKiB',
    'descendantPeakRssKiB',
    'semanticFactBytes',
    'semanticBodyBytes',
    'physicalBodyBytes',
    'transactionBytes',
    'wireBytes',
    'nativeAllocatedBytes',
    'nativeHeapBytes',
    'nativeSystemBytes',
    'semanticPayloadBytes',
  ]
  const metrics: Record<string, ReturnType<typeof summarizeRatios>> = {}
  for (const name of metricNames) {
    const pairs = [...byBlock]
      .sort(([left], [right]) => left - right)
      .map(([block, values]) => ({
        block: block + 1,
        baseline: values.get(baseline)!.metrics[name],
        candidate: values.get(candidate)!.metrics[name],
      }))
    metrics[name] = summarizeRatios(pairs)
  }
  const queryNames = new Set<string>()
  for (const sample of samples) {
    for (const key of Object.keys(sample.metrics.query)) queryNames.add(key)
  }
  const query: Record<string, ReturnType<typeof summarizeRatios>> = {}
  for (const name of [...queryNames].sort()) {
    const pairs = [...byBlock]
      .sort(([left], [right]) => left - right)
      .flatMap(([block, values]) => {
        const left = values.get(baseline)!.metrics.query[name]
        const right = values.get(candidate)!.metrics.query[name]
        return left === undefined || right === undefined
          ? []
          : [{ block: block + 1, baseline: left, candidate: right }]
      })
    if (pairs.length) query[name] = summarizeRatios(pairs)
  }
  return { baseline, candidate, metrics, query }
}

function summarizeRatios(
  pairs: readonly { readonly block: number; readonly baseline: number; readonly candidate: number }[],
) {
  const ratios = pairs.map((pair) => pair.candidate / pair.baseline)
  const medianRatio = median(ratios)
  const absoluteDeviations = ratios.map((ratio) => Math.abs(ratio - medianRatio))
  const bootstrap = bootstrapMedianInterval(ratios, 10_000)
  return {
    pairs,
    candidateOverBaseline: round(medianRatio, 6),
    baselineOverCandidate: round(1 / medianRatio, 6),
    medianAbsoluteDeviation: round(median(absoluteDeviations), 6),
    bootstrap95: bootstrap,
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
    const sample = Array.from({ length: values.length }, () =>
      values[Math.floor(next() * values.length)]!,
    )
    medians.push(median(sample))
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

function nativeMetric(profile: ProjectProfile, phase: string, metric: string): number {
  const values = profile.events
    .filter((event) => event.component === 'native' && event.phase === phase)
    .map((event) => event.metrics?.[metric])
    .filter((value): value is number => typeof value === 'number')
  assert(values.length, `Native telemetry ${phase}.${metric} is unavailable.`)
  return values.reduce((sum, value) => sum + value, 0)
}

function nativeNamespaceBytes(profile: ProjectProfile, namespace: string): number {
  const event = profile.events.find(
    (candidate) =>
      candidate.component === 'native' &&
      candidate.phase === 'facts.namespace' &&
      candidate.metrics?.namespace === namespace,
  )
  const bytes = event?.metrics?.physicalJsonBytes
  assert.equal(typeof bytes, 'number', `Native namespace bytes are unavailable for ${namespace}.`)
  return bytes as number
}

function nativeBodyFields(profile: ProjectProfile): Readonly<Record<string, number>> {
  return Object.fromEntries(
    profile.events
      .filter(
        (event) => event.component === 'native' && event.phase === 'facts.body-physical-field',
      )
      .map((event) => [String(event.metrics?.field), Number(event.metrics?.bytes)])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  )
}

function sampleProcessTree(pid: number, intervalMs: number) {
  let stopped = false
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
      const rows = stdout
        .trim()
        .split('\n')
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
      // RSS attribution is diagnostic and cannot alter the analysis result.
    } finally {
      sampling = false
    }
  }
  void sample()
  const timer = setInterval(() => void sample(), intervalMs)
  timer.unref()
  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      await sample()
      assert(stopped)
      return { rootPeakKiB, descendantPeakKiB, totalPeakKiB }
    },
  }
}

async function digestTree(root: string): Promise<{ readonly digest: string; readonly files: number }> {
  const hash = createHash('sha256')
  let files = 0
  const excluded = new Set(['.cache', '.git', 'dist', 'node_modules'])
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue
      const path = join(directory, entry.name)
      const portable = relative(root, path).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        const value = await readFile(path)
        hash.update(`file\0${portable}\0${value.byteLength}\0`).update(value)
        files++
      } else if (entry.isSymbolicLink()) {
        hash.update(`link\0${portable}\0${await readlink(path)}\0`)
        files++
      }
    }
  }
  await visit(root)
  return { digest: hash.digest('hex'), files }
}

async function gitState(root: string) {
  try {
    const [{ stdout: revision }, { stdout: status }, { stdout: diff }] = await Promise.all([
      execute('git', ['-C', root, 'rev-parse', 'HEAD']),
      execute('git', ['-C', root, 'status', '--short']),
      execute('git', ['-C', root, 'diff', '--binary', 'HEAD'], { maxBuffer: 64 * 1_024 * 1_024 }),
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

async function optionalJson(path: string): Promise<unknown> {
  try {
    await lstat(path)
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function boundedAppend(current: string, chunk: string): string {
  const next = current + chunk
  return next.length <= 64 * 1_024 ? next : next.slice(-64 * 1_024)
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

function requiredTarget(value: string): 'codegraph' | 'kernel' {
  if (value !== 'codegraph' && value !== 'kernel') {
    throw new Error('--target must be codegraph or kernel.')
  }
  return value
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive.`)
  return parsed
}

interface ProjectProfile {
  readonly native: string
  readonly compact: boolean
  readonly payloadMaterialization: 'inline-json' | 'shard-brotli'
  readonly sqliteBytes: number
  readonly sqliteAttribution: Readonly<Record<string, number>>
  readonly projects: readonly {
    readonly generation: string
    readonly universe: string
    readonly sourceManifest: string
    readonly semanticDigest: string
    readonly boundFactDigest: string
    readonly manifestDigest: string
    readonly facts: number
    readonly factBytes: number
    readonly namespaceBytes: Readonly<Record<string, number>>
    readonly sqliteMs: number
    readonly queryWorkloads: Readonly<Record<string, number>>
  }[]
  readonly events: readonly {
    readonly component: string
    readonly phase: string
    readonly metrics?: Readonly<Record<string, string | number | boolean>>
  }[]
}

type ScalarMetric = Exclude<keyof RunSample['metrics'], 'query' | 'sqliteAttribution' | 'physicalBodyFields'>

interface RunSample {
  readonly condition: ConditionId
  readonly warmup: boolean
  readonly block: number
  readonly position: number
  readonly artifact: string
  readonly artifactSha256: string
  readonly wallMs: number
  readonly identity: {
    readonly generation: string
    readonly universe: string
    readonly sourceManifest: string
    readonly semanticDigest: string
    readonly boundFactDigest: string
    readonly manifestDigest: string
    readonly facts: number
  }
  readonly metrics: {
    readonly coldMs: number
    readonly sqliteBytes: number
    readonly processTreePeakRssKiB: number
    readonly nodePeakRssKiB: number
    readonly descendantPeakRssKiB: number
    readonly semanticFactBytes: number
    readonly semanticBodyBytes: number
    readonly physicalBodyBytes: number
    readonly transactionBytes: number
    readonly wireBytes: number
    readonly nativeAllocatedBytes: number
    readonly nativeHeapBytes: number
    readonly nativeSystemBytes: number
    readonly semanticPayloadBytes: number
    readonly query: Readonly<Record<string, number>>
    readonly sqliteAttribution: Readonly<Record<string, number>>
    readonly physicalBodyFields: Readonly<Record<string, number>>
  }
}

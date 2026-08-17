import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { codegraphProducerFingerprint } from '../../../application/node/fingerprint.ts'
import { CLI_CHECK_LIMITS } from '../../../cli/limits.ts'

const execute = promisify(execFile)
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024
const CHECK_SUMMARY =
  /Checked (?:selected )?\d+ specifications?(?: \(\+\d+ support\))?: \d+ diagnostics?\./u

export interface CliRestartScenario {
  readonly id: string
  readonly select: readonly string[]
}

export interface CliRestartQualificationOptions {
  readonly root: string
  readonly cli: string
  readonly cacheDirectory: string
  readonly output?: string
  readonly scenarios: readonly CliRestartScenario[]
  readonly warmSamples?: number
  readonly warmWholeLimitMs?: number
  readonly warmSelectedLimitMs?: number
  readonly processTimeoutMs?: number
  readonly coldTimeoutMs?: number
  readonly requireCleanGit?: boolean
}

interface ProcessEvidence {
  readonly pid: number
  readonly argv: readonly string[]
  readonly elapsedMs: number
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly timedOut: boolean
  readonly outputExceeded: boolean
  readonly stdout: string
  readonly stderr: string
  readonly outputSha256: string
  readonly summaryObserved: boolean
  readonly cache: CacheState
}

interface CacheState {
  readonly files: number
  readonly bytes: number
  readonly manifests: readonly {
    readonly path: string
    readonly bytes: number
    readonly sha256: string
    readonly format?: string
    readonly version?: number
    readonly producerFingerprint?: string
    readonly scope?: string
    readonly payload?: unknown
  }[]
}

interface ScenarioEvidence {
  readonly id: string
  readonly select: readonly string[]
  readonly limitMs: number
  readonly prime: ProcessEvidence
  readonly samples: readonly ProcessEvidence[]
  readonly p95Ms: number
  readonly expectedOutputSha256: string
}

export interface CliRestartQualificationEvidence {
  readonly format: 'astrale.codegraph.cli-restart-qualification'
  readonly version: 1
  readonly status: 'qualified' | 'failed'
  readonly subject: {
    readonly root: string
    readonly rootHead?: string
    readonly rootStatusSha256?: string
    readonly rootClean?: boolean
    readonly cli: string
    readonly cliSha256: string
    readonly cliPackageRoot: string
    readonly cliPackageProducerFingerprint: string
    readonly cliPackageJsonSha256: string
    readonly cliNativeReleaseSha256?: string
    readonly packageJsonSha256?: string
    readonly lockfileSha256?: string
  }
  readonly environment: {
    readonly node: string
    readonly platform: NodeJS.Platform
    readonly architecture: string
    readonly logicalCpus: number
    readonly nodeOptions?: string
    readonly harnessSha256: string
  }
  readonly method: {
    readonly processBoundary: 'distinct-operating-system-processes'
    readonly cache: string
    readonly cacheInitiallyEmpty: true
    readonly everyRequestPrimed: true
    readonly firstSelectedRequestUnderThreshold: true
    readonly interleaved: true
    readonly warmSamples: number
    readonly exclusiveThreshold: true
    readonly coldReportedSeparately: true
  }
  readonly cold: ProcessEvidence
  readonly scenarios: readonly ScenarioEvidence[]
  readonly violations: readonly string[]
  readonly evidenceSha256: string
}

export async function qualifyCliRestart(
  options: CliRestartQualificationOptions,
): Promise<CliRestartQualificationEvidence> {
  const root = await realpath(resolve(options.root))
  const cli = await realpath(resolve(options.cli))
  const cacheDirectory = resolve(options.cacheDirectory)
  const output = options.output ? resolve(options.output) : undefined
  const warmSamples = options.warmSamples ?? CLI_CHECK_LIMITS.minimumWarmSamples
  const warmWholeLimitMs = options.warmWholeLimitMs ?? CLI_CHECK_LIMITS.maximumWarmWholeMilliseconds
  const warmSelectedLimitMs =
    options.warmSelectedLimitMs ?? CLI_CHECK_LIMITS.maximumWarmSelectedMilliseconds
  const processTimeoutMs =
    options.processTimeoutMs ?? CLI_CHECK_LIMITS.maximumWarmProcessMilliseconds
  const coldTimeoutMs = options.coldTimeoutMs ?? 10 * 60_000
  validateOptions({
    scenarios: options.scenarios,
    warmSamples,
    warmWholeLimitMs,
    warmSelectedLimitMs,
    processTimeoutMs,
    coldTimeoutMs,
  })

  await mkdir(cacheDirectory, { recursive: true })
  if ((await readdir(cacheDirectory)).length !== 0) {
    throw new Error(`CLI restart qualification cache must be empty: ${cacheDirectory}`)
  }
  const git = await gitSubject(root)
  const violations: string[] = []
  if (options.requireCleanGit !== false) {
    if (!git) violations.push('Kernel qualification root is not a Git worktree.')
    else if (!git.clean) violations.push('Kernel qualification root is not clean.')
  }
  const cliSha256 = await fileSha256(cli)
  const cliPackageRoot =
    basename(dirname(cli)) === '.bin'
      ? resolve(dirname(cli), '..', '@astrale-os', 'codegraph')
      : basename(dirname(cli)) === 'dist'
        ? dirname(dirname(cli))
        : dirname(cli)
  const cliPackageProducerFingerprint = await codegraphProducerFingerprint(cliPackageRoot)
  const harnessSha256 = await fileSha256(new URL(import.meta.url))
  const common = ['check', root, '--require-complete-layout', '--quiet'] as const
  const cold = await runCli(cli, common, cacheDirectory, coldTimeoutMs)
  validateProcess('cold whole check', cold, undefined, violations)
  if (
    !cold.cache.manifests.some(
      (manifest) => manifest.format === 'astrale.codegraph.cli-check-catalog',
    )
  ) {
    violations.push('Cold whole check published no selected-check catalog.')
  }

  const scenarios = [
    { id: 'whole', select: [] as readonly string[], limitMs: warmWholeLimitMs },
    ...options.scenarios.map((scenario) => ({
      id: scenario.id,
      select: [...scenario.select],
      limitMs: warmSelectedLimitMs,
    })),
  ]
  const samples = new Map(scenarios.map((scenario) => [scenario.id, [] as ProcessEvidence[]]))
  const primes = new Map<string, ProcessEvidence>([['whole', cold]])
  const expected = new Map<string, string>([['whole', cold.outputSha256]])
  for (const scenario of scenarios.filter((value) => value.id !== 'whole')) {
    const args = [...common, ...scenario.select.flatMap((value) => ['--select', value])]
    const prime = await runCli(cli, args, cacheDirectory, processTimeoutMs)
    validateProcess(`${scenario.id} canonical prime`, prime, undefined, violations)
    if (prime.elapsedMs >= scenario.limitMs) {
      violations.push(
        `${scenario.id} first selected request took ${prime.elapsedMs} ms; required < ${scenario.limitMs} ms after the whole prime.`,
      )
    }
    primes.set(scenario.id, prime)
    expected.set(scenario.id, prime.outputSha256)
  }
  for (let round = 0; round < warmSamples; round++) {
    for (const scenario of scenarios) {
      const args = [...common, ...scenario.select.flatMap((value) => ['--select', value])]
      const measured = await runCli(cli, args, cacheDirectory, processTimeoutMs)
      const expectedDigest = expected.get(scenario.id)
      validateProcess(
        `${scenario.id} warm sample ${round + 1}`,
        measured,
        expectedDigest,
        violations,
      )
      samples.get(scenario.id)!.push(measured)
    }
  }

  const processIds = [
    cold.pid,
    ...[...primes.entries()].filter(([id]) => id !== 'whole').map(([, prime]) => prime.pid),
    ...[...samples.values()].flat().map((sample) => sample.pid),
  ]
  if (new Set(processIds).size !== processIds.length) {
    violations.push('CLI qualification reused an operating-system process identifier.')
  }
  const scenarioEvidence = scenarios.map((scenario): ScenarioEvidence => {
    const measured = samples.get(scenario.id)!
    const p95Ms = percentile(
      measured.map((sample) => sample.elapsedMs),
      0.95,
    )
    for (const [index, sample] of measured.entries()) {
      if (sample.elapsedMs >= scenario.limitMs) {
        violations.push(
          `${scenario.id} warm sample ${index + 1} took ${sample.elapsedMs} ms; required < ${scenario.limitMs} ms.`,
        )
      }
    }
    if (p95Ms >= scenario.limitMs) {
      violations.push(
        `${scenario.id} warm p95 took ${p95Ms} ms; required < ${scenario.limitMs} ms.`,
      )
    }
    return {
      id: scenario.id,
      select: scenario.select,
      limitMs: scenario.limitMs,
      prime: primes.get(scenario.id)!,
      samples: measured,
      p95Ms,
      expectedOutputSha256: expected.get(scenario.id)!,
    }
  })

  const subject = {
    root,
    ...(git
      ? {
          rootHead: git.head,
          rootStatusSha256: sha256(git.status),
          rootClean: git.clean,
        }
      : {}),
    cli,
    cliSha256,
    cliPackageRoot,
    cliPackageProducerFingerprint,
    cliPackageJsonSha256: await fileSha256(join(cliPackageRoot, 'package.json')),
    ...(await optionalFileDigest(
      join(cliPackageRoot, 'native-release.json'),
      'cliNativeReleaseSha256',
    )),
    ...(await optionalFileDigest(join(root, 'package.json'), 'packageJsonSha256')),
    ...(await optionalFileDigest(join(root, 'pnpm-lock.yaml'), 'lockfileSha256')),
  }
  const unsigned = {
    format: 'astrale.codegraph.cli-restart-qualification' as const,
    version: 1 as const,
    status: violations.length ? ('failed' as const) : ('qualified' as const),
    subject,
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpus: cpus().length,
      ...(process.env.NODE_OPTIONS ? { nodeOptions: process.env.NODE_OPTIONS } : {}),
      harnessSha256,
    },
    method: {
      processBoundary: 'distinct-operating-system-processes' as const,
      cache: cacheDirectory,
      cacheInitiallyEmpty: true as const,
      everyRequestPrimed: true as const,
      firstSelectedRequestUnderThreshold: true as const,
      interleaved: true as const,
      warmSamples,
      exclusiveThreshold: true as const,
      coldReportedSeparately: true as const,
    },
    cold,
    scenarios: scenarioEvidence,
    violations: [...new Set(violations)],
  }
  const evidence: CliRestartQualificationEvidence = {
    ...unsigned,
    evidenceSha256: sha256(JSON.stringify(unsigned)),
  }
  if (output) {
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  }
  return evidence
}

async function runCli(
  cli: string,
  args: readonly string[],
  cacheDirectory: string,
  timeoutMs: number,
): Promise<ProcessEvidence> {
  const executable = /\.(?:[cm]?js|ts)$/u.test(cli) ? process.execPath : cli
  const argv = executable === process.execPath ? [cli, ...args] : [...args]
  const started = process.hrtime.bigint()
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let outputExceeded = false
  const detached = process.platform !== 'win32'
  const child = spawn(executable, argv, {
    cwd: resolve(args[1]!),
    detached,
    env: { ...process.env, ASTRALE_TYPESPEC_CACHE_DIR: cacheDirectory, CI: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const pid = child.pid
  if (pid === undefined) throw new Error('CLI process has no operating-system process identifier.')
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const append = (target: 'stdout' | 'stderr', chunk: string): void => {
    if (target === 'stdout') stdout += chunk
    else stderr += chunk
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > OUTPUT_LIMIT_BYTES) {
      outputExceeded = true
      terminate(child, pid, 'SIGTERM')
    }
  }
  child.stdout.on('data', (chunk: string) => append('stdout', chunk))
  child.stderr.on('data', (chunk: string) => append('stderr', chunk))
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (complete, reject) => {
      const timeout = setTimeout(() => {
        timedOut = true
        terminate(child, pid, 'SIGTERM')
        setTimeout(() => terminate(child, pid, 'SIGKILL'), 2_000).unref()
      }, timeoutMs)
      timeout.unref()
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        complete({ code, signal })
      })
    },
  )
  const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n)
  const outputSha256 = sha256(
    JSON.stringify({
      exitCode: result.code,
      signal: result.signal,
      stdout,
      stderr,
    }),
  )
  return {
    pid,
    argv: [executable, ...argv],
    elapsedMs,
    exitCode: result.code,
    signal: result.signal,
    timedOut,
    outputExceeded,
    stdout,
    stderr,
    outputSha256,
    summaryObserved: CHECK_SUMMARY.test(`${stdout}\n${stderr}`),
    cache: await cacheState(cacheDirectory),
  }
}

function validateProcess(
  label: string,
  value: ProcessEvidence,
  expectedOutputSha256: string | undefined,
  violations: string[],
): void {
  if (value.timedOut) violations.push(`${label} exceeded its process watchdog.`)
  if (value.outputExceeded) violations.push(`${label} exceeded the bounded output budget.`)
  if (value.signal) violations.push(`${label} exited by signal ${value.signal}.`)
  if (!value.summaryObserved) violations.push(`${label} produced no cg check summary.`)
  if (expectedOutputSha256 && value.outputSha256 !== expectedOutputSha256) {
    violations.push(`${label} changed exit status or byte-exact output.`)
  }
  if (!value.cache.manifests.length) violations.push(`${label} published no checkpoint manifest.`)
}

function validateOptions(options: {
  scenarios: readonly CliRestartScenario[]
  warmSamples: number
  warmWholeLimitMs: number
  warmSelectedLimitMs: number
  processTimeoutMs: number
  coldTimeoutMs: number
}): void {
  if (options.warmSamples < CLI_CHECK_LIMITS.minimumWarmSamples) {
    throw new RangeError(
      `CLI restart qualification requires at least ${CLI_CHECK_LIMITS.minimumWarmSamples} warm samples.`,
    )
  }
  if (!options.scenarios.length || options.scenarios.some((scenario) => !scenario.select.length)) {
    throw new Error('CLI restart qualification requires at least one non-empty selected scenario.')
  }
  const ids = options.scenarios.map((scenario) => scenario.id)
  if (ids.some((id) => !/^[a-z0-9][a-z0-9-]*$/u.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('CLI restart scenario ids must be unique lowercase safe names.')
  }
  for (const [name, value] of Object.entries({
    warmWholeLimitMs: options.warmWholeLimitMs,
    warmSelectedLimitMs: options.warmSelectedLimitMs,
    processTimeoutMs: options.processTimeoutMs,
    coldTimeoutMs: options.coldTimeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive.`)
  }
  if (
    options.processTimeoutMs < options.warmWholeLimitMs ||
    options.processTimeoutMs < options.warmSelectedLimitMs
  ) {
    throw new RangeError('CLI process watchdog must not be below a governed warm threshold.')
  }
}

async function cacheState(root: string): Promise<CacheState> {
  const files = await listFiles(root)
  const manifests = []
  let bytes = 0
  for (const file of files) {
    const metadata = await stat(file)
    bytes += metadata.size
    const portable = relative(root, file).split('\\').join('/')
    if (!portable.includes('/manifests/')) continue
    if (!file.endsWith('.json')) continue
    const raw = await readFile(file)
    let value: Record<string, unknown> | undefined
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        value = parsed as Record<string, unknown>
    } catch {
      // Corrupt manifests remain attributable by bytes and digest.
    }
    manifests.push({
      path: portable,
      bytes: raw.byteLength,
      sha256: sha256(raw),
      ...(typeof value?.format === 'string' ? { format: value.format } : {}),
      ...(typeof value?.version === 'number' ? { version: value.version } : {}),
      ...(typeof value?.producerFingerprint === 'string'
        ? { producerFingerprint: value.producerFingerprint }
        : {}),
      ...(typeof value?.scope === 'string' ? { scope: value.scope } : {}),
      ...(value?.payload !== undefined ? { payload: value.payload } : {}),
    })
  }
  return {
    files: files.length,
    bytes,
    manifests: manifests.sort((a, b) => a.path.localeCompare(b.path)),
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(path)))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

async function gitSubject(
  root: string,
): Promise<{ head: string; status: string; clean: boolean } | undefined> {
  try {
    const head = (
      await execute('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
    ).stdout.trim()
    const status = (
      await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: OUTPUT_LIMIT_BYTES,
      })
    ).stdout
    return { head, status, clean: status.length === 0 }
  } catch {
    return undefined
  }
}

async function optionalFileDigest<Key extends string>(
  file: string,
  key: Key,
): Promise<{ readonly [Name in Key]?: string }> {
  try {
    return { [key]: await fileSha256(file) } as { [Name in Key]?: string }
  } catch {
    return {}
  }
}

async function fileSha256(file: string | URL): Promise<string> {
  return sha256(await readFile(file))
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (!values.length) throw new Error('Cannot calculate a percentile without samples.')
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * percentileValue) - 1]!
}

function terminate(child: ReturnType<typeof spawn>, pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-pid, signal)
  } catch {
    // The process may have exited between observation and termination.
  }
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`Missing required argument ${name}.`)
  return value
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function repeatedArgument(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1])
      values.push(process.argv[index + 1]!)
  }
  return values
}

function parseScenario(value: string): CliRestartScenario {
  const separator = value.indexOf('=')
  if (separator < 1) throw new Error(`Invalid --scenario ${value}; expected id=path[,path].`)
  const id = value.slice(0, separator)
  const select = value
    .slice(separator + 1)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return { id, select }
}

async function main(): Promise<void> {
  const output = resolve(requiredArgument('--output'))
  const evidence = await qualifyCliRestart({
    root: requiredArgument('--root'),
    cli: requiredArgument('--cli'),
    cacheDirectory: requiredArgument('--cache'),
    output,
    scenarios: repeatedArgument('--scenario').map(parseScenario),
    requireCleanGit: !process.argv.includes('--allow-dirty'),
  })
  process.stdout.write(
    `${JSON.stringify(
      {
        status: evidence.status,
        output,
        evidenceSha256: evidence.evidenceSha256,
        coldMs: evidence.cold.elapsedMs,
        scenarios: evidence.scenarios.map(({ id, p95Ms, limitMs }) => ({ id, p95Ms, limitMs })),
        violations: evidence.violations,
      },
      null,
      2,
    )}\n`,
  )
  process.exitCode = evidence.status === 'qualified' ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()

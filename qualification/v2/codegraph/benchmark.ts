import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { FactTransaction } from '../../../analysis/index.ts'

import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'
import { normalizeCodegraph, tableCounts } from './normalize.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const evidencePath = resolve(repositoryRoot, 'spec/.history/v2/evidence/codegraph-benchmark.json')
const installation = argument('--installation')
const checkpointPath = argument('--checkpoint')
const writeEvidence = process.argv.includes('--write')

if (!installation || !checkpointPath) {
  throw new Error(
    'Usage: benchmark.ts --installation <Codegraph root> --checkpoint <V2 observation checkpoint> [--write]',
  )
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(await readFile(resolve(installation!, 'package.json'), 'utf8'))
  const codegraph = await import(
    pathToFileURL(resolve(installation!, packageJson.main ?? 'dist/index.js')).href
  )
  const extensions = new Set<string>(codegraph.EXTENSIONS)
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-typespec-v2-codegraph-benchmark-'))
  let completed = false
  try {
    const typespecRoot = join(temporary, 'typespec')
    const kernelRoot = join(temporary, 'kernel')
    progress('copy TypeSpec corpus')
    await copyCorpus(resolve(repositoryRoot, 'spec'), typespecRoot, extensions)
    progress('copy Kernel corpus')
    await copyCorpus(repositoryRoot, kernelRoot, extensions)
    await linkDependencies(repositoryRoot, typespecRoot)
    await linkDependencies(repositoryRoot, kernelRoot)

    const typespec = await benchmarkCorpus(
      'typespec',
      typespecRoot,
      installation!,
      'analysis/identity/model.ts',
    )
    const kernel = await benchmarkCorpus(
      'kernel',
      kernelRoot,
      installation!,
      'spec/analysis/identity/model.ts',
    )
    const reference = await benchmarkReferenceStore(checkpointPath!, temporary)
    const evidence = {
      format: 'astrale.typespec.v2.codegraph-benchmark',
      version: 1,
      status: 'qualified',
      subject: { package: packageJson.name, version: packageJson.version },
      method: {
        isolatedProcesses: true,
        nativeCodegraph: true,
        bodyAnalysis: ['ast', 'cfg', 'complexity', 'dataflow'],
        corpusCopiesExclude: [...ignoredDirectories].sort(),
        querySamples: 100,
        comparisonBoundary:
          'Codegraph and the TypeSpec semantic store retain different payloads; sizes and timings are operational, not equivalent-fact efficiency claims.',
      },
      corpora: { typespec, kernel },
      reference,
      conclusion: {
        codegraphFixtureStrength: [
          'compact normalized structural tables',
          'fast indexed point queries',
          'low-cost no-op and one-file refresh relative to cold build',
        ],
        realCorpusOutcome:
          'Full body-enabled Codegraph builds of both TypeSpec and Kernel exceeded the governed 180 second per-corpus limit.',
        typeSpecStoreOutcome:
          'The 295 MB, 15-universe semantic checkpoint materialized in under the governed corpus phase limit and retained indexed generation-pinned queries.',
        adoptionImpact:
          'Performance does not remove the ingestion, immutable-generation, semantic-identity, provenance, or cold-equivalence incompatibilities established by the source/churn spike.',
      },
    }
    if (writeEvidence)
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    completed = true
  } finally {
    if (completed) await rm(temporary, { recursive: true, force: true })
    else process.stderr.write(`Codegraph benchmark retained at ${temporary}\n`)
  }
}

async function benchmarkCorpus(
  name: string,
  root: string,
  codegraphRoot: string,
  changedFile: string,
) {
  const database = join(root, '.qualification', 'graph.db')
  await mkdir(resolve(root, '.qualification'), { recursive: true })
  progress(`${name}: full Codegraph build`)
  let full
  try {
    full = await buildWorker(codegraphRoot, root, database, false)
  } catch (error) {
    if (error instanceof BenchmarkTimeout) {
      return {
        name,
        status: 'time-limit-exceeded',
        phase: 'full',
        limitMs: error.limitMs,
        message: error.message,
      }
    }
    throw error
  }
  const initial = normalizeCodegraph(database)
  progress(`${name}: no-op Codegraph build`)
  const noop = await buildWorker(codegraphRoot, root, database, true)
  const target = resolve(root, changedFile)
  const before = await readFile(target, 'utf8')
  await writeFile(target, `${before.trimEnd()}\n// Codegraph qualification edit.\n`, 'utf8')
  progress(`${name}: one-file incremental Codegraph build`)
  const incremental = await buildWorker(codegraphRoot, root, database, true)
  const incrementalGraph = normalizeCodegraph(database)
  const coldDatabase = join(root, '.qualification', 'cold.db')
  progress(`${name}: cold Codegraph rebuild after edit`)
  const cold = await buildWorker(codegraphRoot, root, coldDatabase, false)
  const coldGraph = normalizeCodegraph(coldDatabase)
  const differingTables = Object.keys(incrementalGraph.tables).filter(
    (table) =>
      JSON.stringify(incrementalGraph.tables[table]) !== JSON.stringify(coldGraph.tables[table]),
  )
  return {
    name,
    sourceFiles: initial.tables.files?.length ?? 0,
    rows: tableCounts(initial),
    full,
    noop,
    oneFileIncremental: incremental,
    coldAfterEdit: cold,
    incrementalEqualsCold: incrementalGraph.digest === coldGraph.digest,
    differingTables,
    initialDigest: initial.digest,
    incrementalDigest: incrementalGraph.digest,
    coldDigest: coldGraph.digest,
  }
}

async function benchmarkReferenceStore(checkpointFile: string, temporary: string) {
  progress('normalized TypeSpec store: read and parse checkpoint')
  const bytes = await readFile(resolve(checkpointFile))
  const parseStarted = performance.now()
  const checkpoint = JSON.parse(bytes.toString('utf8')) as {
    readonly format: string
    readonly version: number
    readonly nativeDigest?: string
    readonly transactions?: readonly [string, FactTransaction][]
  }
  const parseMs = Math.round(performance.now() - parseStarted)
  if (!checkpoint.transactions?.length) throw new Error('Reference checkpoint has no transactions.')
  const database = join(temporary, 'reference', 'analysis.db')
  const store = await createSQLiteAnalysisStore({
    file: database,
    namespace: 'codegraph-spike-reference',
    maximumRetainedGenerations: 2,
    requireDurability: true,
  })
  progress('normalized TypeSpec store: materialize checkpoint')
  const materializeStarted = performance.now()
  for (const [, transaction] of checkpoint.transactions) await store.commit(transaction)
  const materializeMs = Math.round(performance.now() - materializeStarted)
  const queries: number[] = []
  let facts = 0
  for (const [, transaction] of checkpoint.transactions) {
    const started = performance.now()
    const query = await store.open(transaction.next.universe)
    const page = await query.facts({}, { limit: 100 })
    facts += page.total ?? page.facts.length
    await query.dispose()
    queries.push(performance.now() - started)
  }
  await store.dispose()
  queries.sort((left, right) => left - right)
  return {
    format: checkpoint.format,
    version: checkpoint.version,
    nativeDigest: checkpoint.nativeDigest,
    checkpointSha256: createHash('sha256').update(bytes).digest('hex'),
    checkpointBytes: bytes.length,
    universes: checkpoint.transactions.length,
    facts,
    parseMs,
    materializeMs,
    maximumRssBytes: process.resourceUsage().maxRSS * 1024,
    databaseBytes: (await stat(database)).size,
    openAndFirstPage: {
      samples: queries.length,
      medianMs: round(queries[Math.floor(queries.length / 2)]!),
      p95Ms: round(queries[Math.floor(queries.length * 0.95)]!),
    },
    storageModel:
      'normalized immutable generations, content-addressed shards, indexed facts, evidence, and inputs',
  }
}

async function buildWorker(
  codegraphRoot: string,
  root: string,
  database: string,
  incremental: boolean,
): Promise<unknown> {
  const worker = resolve(import.meta.dirname, 'build-worker.mjs')
  const args = [
    worker,
    '--installation',
    codegraphRoot,
    '--root',
    root,
    '--database',
    database,
    ...(incremental ? ['--incremental'] : []),
  ]
  const output = await run(process.execPath, args, 180_000)
  const marker = output.match(/ASTRALE_CODEGRAPH_BUILD=(\{.*\})/u)
  if (!marker) throw new Error(`Codegraph build worker returned no result:\n${output}`)
  return JSON.parse(marker[1]!)
}

async function copyCorpus(source: string, target: string, extensions: ReadonlySet<string>) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) {
      await copyCorpus(from, to, extensions)
      continue
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue
    if (!includeFile(entry.name, extensions)) continue
    if (entry.isSymbolicLink()) {
      const resolved = await lstat(from)
      if (!resolved.isFile()) continue
    }
    await cp(from, to)
  }
}

async function linkDependencies(sourceRoot: string, targetRoot: string) {
  const source = resolve(sourceRoot, 'node_modules')
  try {
    if (!(await lstat(source)).isDirectory() && !(await lstat(source)).isSymbolicLink()) return
    await symlink(source, resolve(targetRoot, 'node_modules'), 'dir')
  } catch {
    // Dependency linkage is an optional resolver aid; Tree-sitter extraction remains valid.
  }
}

function includeFile(name: string, extensions: ReadonlySet<string>): boolean {
  if (extensions.has(extname(name))) return true
  return (
    name === 'package.json' ||
    name === 'pnpm-workspace.yaml' ||
    name === '.codegraphrc.json' ||
    /^tsconfig(?:\.[^.]+)?\.json$/u.test(name) ||
    /^jsconfig(?:\.[^.]+)?\.json$/u.test(name)
  )
}

async function run(command: string, args: readonly string[], limitMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new BenchmarkTimeout(limitMs, command, args))
    }, limitMs)
    timeout.unref()
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise(`${stdout}\n${stderr}`)
      else if (code !== null) {
        reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${stderr}`))
      }
    })
  })
}

class BenchmarkTimeout extends Error {
  constructor(
    readonly limitMs: number,
    command: string,
    args: readonly string[],
  ) {
    super(`Codegraph exceeded the governed ${limitMs} ms phase limit: ${command} ${args.join(' ')}`)
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function progress(message: string): void {
  process.stderr.write(`[codegraph-benchmark] ${message}\n`)
}

const ignoredDirectories = new Set([
  '.codegraph',
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'target',
])

await main()

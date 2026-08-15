import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  createMemoryAnalysisStore,
  deriveAnalysisId,
  runAnalysisPolicies,
  type AnalysisGenerationId,
  type AnalysisTelemetryEvent,
  type AnalysisTelemetrySink,
  type NativeModuleBoundary,
  type ProjectUniverseId,
} from '../../../analysis/index.ts'
import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'
import {
  createTypeScriptFactReader,
  TYPESCRIPT_FACT_PAYLOAD_CODECS,
  type TypeScriptFact,
} from '../../../analysis/typescript/index.ts'
import { createBoundedValueEvaluator } from '../../../analysis/typescript/value/index.ts'
import { resolveApplicationModuleBoundaries } from '../../../application/analysis/index.ts'
import {
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from '../../../application/discovery/index.ts'
import { compileSpecificationSnapshots } from '../../../specification/index.ts'
import { analyzeProject, summarizeGeneration } from '../self-host/analyze.ts'
import type { SelfHostTargetId } from '../self-host/model.ts'

const target = requiredTarget(argument('--target') ?? 'codegraph')
const root = await resolveApplicationRoot(requiredArgument('--root'))
const binary = resolve(requiredArgument('--native-binary'))
const output = argument('--output')
const selectedProject = argument('--project')
const capabilities = optionalCapabilities(argument('--capabilities'))
const compact = process.argv.includes('--compact')
const backend = requiredBackend(argument('--backend') ?? 'both')
const payloadMaterialization = requiredPayloadMaterialization(
  argument('--materialization') ?? 'shard-brotli',
)
const temporary = await mkdtemp(join(tmpdir(), 'codegraph-profile-project-'))
const events: (AnalysisTelemetryEvent & {
  readonly context: { readonly backend: 'memory' | 'sqlite'; readonly project: string }
})[] = []

try {
  const directories = await discoverSpecificationDirectories(root, {
    ...(target === 'kernel' ? { exclude: ['spec'] } : {}),
  })
  const specifications = await compileSpecificationSnapshots(root, directories)
  const resolution = await resolveApplicationModuleBoundaries(root, specifications)
  assert.deepEqual(resolution.diagnostics, [])
  const projects = groupByProject(resolution.boundaries)
  const selected = selectedProject
    ? new Map([...projects].filter(([project]) => project === selectedProject))
    : projects
  if (!selected.size) throw new Error(`No analyzable project matched ${selectedProject ?? root}.`)

  const memoryResults = new Map<string, Awaited<ReturnType<typeof runProject>>>()
  if (backend !== 'sqlite') {
    const memory = createMemoryAnalysisStore({
      maximumRetainedGenerations: 1,
      telemetry: scopedTelemetry('memory'),
    })
    try {
      for (const [project, modules] of selected) {
        memoryResults.set(project, await runProject('memory', project, modules, memory))
      }
    } finally {
      await memory.dispose()
    }
  }

  const sqliteFile = join(temporary, 'profile.sqlite')
  const sqliteResults = new Map<string, Awaited<ReturnType<typeof runProject>>>()
  if (backend !== 'memory') {
    const sqlite = await createSQLiteAnalysisStore({
      file: sqliteFile,
      namespace: `profile-${target}`,
      maximumRetainedGenerations: 1,
      telemetry: scopedTelemetry('sqlite'),
      payloadMaterialization,
      ...(compact ? { payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS } : {}),
    })
    try {
      for (const [project, modules] of selected) {
        sqliteResults.set(project, await runProject('sqlite', project, modules, sqlite))
      }
    } finally {
      await sqlite.dispose()
    }
  }

  const projectsResult = [...selected].map(([project, modules]) => {
    const memory = memoryResults.get(project)
    const sqlite = sqliteResults.get(project)
    const observed = memory ?? sqlite
    if (!observed) throw new Error(`No backend analyzed ${project}.`)
    if (memory && sqlite) {
      assert.equal(memory.generation, sqlite.generation)
      assert.equal(memory.semanticDigest, sqlite.semanticDigest)
      assert.equal(memory.boundFactDigest, sqlite.boundFactDigest)
    }
    return {
      project,
      modules: modules.length,
      generation: observed.generation,
      universe: observed.universe,
      ...(memory ? { memoryMs: memory.elapsedMs, memoryQueryMs: memory.queryMs } : {}),
      ...(sqlite ? { sqliteMs: sqlite.elapsedMs, sqliteQueryMs: sqlite.queryMs } : {}),
      facts: observed.facts,
      factBytes: observed.factBytes,
      namespaceBytes: observed.namespaceBytes,
      bodyFieldBytes: observed.bodyFieldBytes,
      bodyOccurrenceFieldBytes: observed.bodyOccurrenceFieldBytes,
      semanticDigest: observed.semanticDigest,
      boundFactDigest: observed.boundFactDigest,
      manifestDigest: observed.manifestDigest,
      sourceManifest: observed.sourceManifest,
      queryWorkloads: observed.queryWorkloads,
    }
  })
  const result = {
    format: 'astrale.codegraph.project-profile',
    version: 1,
    target,
    native: createHash('sha256').update(await readFile(binary)).digest('hex'),
    compact,
    backend,
    payloadMaterialization,
    capabilities: capabilities ?? 'all',
    specifications: specifications.length,
    boundaries: resolution.boundaries.length,
    projects: projectsResult,
    ...(backend !== 'memory'
      ? {
          sqliteBytes: (await stat(sqliteFile)).size,
          sqliteAttribution: sqliteStorageAttribution(sqliteFile),
        }
      : {}),
    process: {
      memoryUsage: process.memoryUsage(),
      resourceUsage: process.resourceUsage(),
    },
    events,
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (output) {
    const destination = resolve(output)
    await writeFile(destination, serialized, 'utf8')
    process.stdout.write(`${JSON.stringify({
      format: result.format,
      version: result.version,
      target: result.target,
      native: result.native,
      compact: result.compact,
      backend: result.backend,
      payloadMaterialization: result.payloadMaterialization,
      capabilities: result.capabilities,
      projects: result.projects,
      ...('sqliteBytes' in result ? { sqliteBytes: result.sqliteBytes } : {}),
      telemetryEvents: result.events.length,
      output: destination,
    }, null, 2)}\n`)
  } else {
    process.stdout.write(serialized)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function runProject(
  backend: 'memory' | 'sqlite',
  project: string,
  modules: readonly NativeModuleBoundary[],
  store: import('../../../analysis/index.ts').AnalysisStore,
) {
  const analyzed = await analyzeProject({
    target,
    root,
    project,
    modules,
    binary,
    store,
    telemetry: scopedTelemetry(backend, project),
    ...(compact ? { payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS } : {}),
    ...(capabilities ? { capabilities } : {}),
  })
  try {
    const queryStarted = performance.now()
    const summary = await summarizeGeneration(target, project, store, analyzed.generation)
    const fullTypedMs = Math.round((performance.now() - queryStarted) * 100) / 100
    const queryWorkloads = await benchmarkQueries(store, analyzed.generation)
    return {
      generation: analyzed.generation.id as AnalysisGenerationId,
      universe: analyzed.generation.universe as ProjectUniverseId,
      elapsedMs: analyzed.elapsedMs,
      queryMs: fullTypedMs,
      queryWorkloads: { fullTypedMs, ...queryWorkloads },
      facts: summary.facts,
      factBytes: summary.factBytes,
      namespaceBytes: summary.namespaceBytes,
      bodyFieldBytes: summary.bodyFieldBytes,
      bodyOccurrenceFieldBytes: summary.bodyOccurrenceFieldBytes,
      semanticDigest: summary.semanticDigest,
      boundFactDigest: summary.boundFactDigest,
      manifestDigest: summary.manifestDigest,
      sourceManifest: analyzed.generation.sourceManifest,
    }
  } finally {
    await analyzed.service.dispose()
  }
}

async function benchmarkQueries(
  store: import('../../../analysis/index.ts').AnalysisStore,
  generation: import('../../../analysis/index.ts').AnalysisGeneration,
) {
  const discovery = await store.open(generation.universe, generation.id)
  let bodyFact: TypeScriptFact<'body'> | undefined
  let valueOccurrence: string | undefined
  let headerDiscoveryMs: number
  let selectiveHydrationMs: number | undefined
  try {
    let started = performance.now()
    const page = await discovery.headers(
      { namespaces: ['typescript.body'] },
      { limit: 1_000 },
    )
    headerDiscoveryMs = round(performance.now() - started)
    const header = page.headers[0]
    if (header) {
      started = performance.now()
      bodyFact = (await createTypeScriptFactReader(discovery).factsById('body', [header.id]))[0]
      selectiveHydrationMs = round(performance.now() - started)
      valueOccurrence = bodyFact ? Object.keys(bodyFact.payload.values).sort()[0] : undefined
    }
  } finally {
    await discovery.dispose()
  }

  let headerPointMs: number | undefined
  if (bodyFact) {
    const query = await store.open(generation.universe, generation.id)
    try {
      const started = performance.now()
      const headers = await query.headersById([bodyFact.id])
      assert.equal(headers.length, 1)
      headerPointMs = round(performance.now() - started)
    } finally {
      await query.dispose()
    }
  }

  const headerPageQuery = await store.open(generation.universe, generation.id)
  let headerFirstPageMs: number
  let headerNextPageMs: number | undefined
  try {
    let started = performance.now()
    const first = await headerPageQuery.headers(
      { namespaces: ['typescript.body'] },
      { limit: 100 },
    )
    headerFirstPageMs = round(performance.now() - started)
    if (first.nextCursor) {
      started = performance.now()
      await headerPageQuery.headers(
        { namespaces: ['typescript.body'] },
        { limit: 100, cursor: first.nextCursor },
      )
      headerNextPageMs = round(performance.now() - started)
    }
  } finally {
    await headerPageQuery.dispose()
  }

  const headerScanQuery = await store.open(generation.universe, generation.id)
  let headerFullScanMs: number
  let headerFullScanFacts = 0
  try {
    const started = performance.now()
    for await (const _header of headerScanQuery.exportHeaders({ namespaces: ['typescript.body'] })) {
      headerFullScanFacts++
    }
    headerFullScanMs = round(performance.now() - started)
  } finally {
    await headerScanQuery.dispose()
  }

  let pointMs: number | undefined
  if (bodyFact) {
    const query = await store.open(generation.universe, generation.id)
    try {
      const started = performance.now()
      const facts = await createTypeScriptFactReader(query).factsById('body', [bodyFact.id])
      assert.equal(facts.length, 1)
      pointMs = round(performance.now() - started)
    } finally {
      await query.dispose()
    }
  }

  const pageQuery = await store.open(generation.universe, generation.id)
  let firstPageMs: number
  let nextPageMs: number | undefined
  try {
    const reader = createTypeScriptFactReader(pageQuery)
    let started = performance.now()
    const first = await reader.facts('body', {}, { limit: 100 })
    firstPageMs = round(performance.now() - started)
    if (first.nextCursor) {
      started = performance.now()
      await reader.facts('body', {}, { limit: 100, cursor: first.nextCursor })
      nextPageMs = round(performance.now() - started)
    }
  } finally {
    await pageQuery.dispose()
  }

  let evaluatorMs: number | undefined
  let evaluatorIndexMs: number | undefined
  if (valueOccurrence) {
    const query = await store.open(generation.universe, generation.id)
    try {
      let started = performance.now()
      const evaluator = await createBoundedValueEvaluator({ query })
      evaluatorIndexMs = round(performance.now() - started)
      started = performance.now()
      await evaluator.evaluate(valueOccurrence as import('../../../analysis/index.ts').OccurrenceId)
      evaluatorMs = round(performance.now() - started)
    } finally {
      await query.dispose()
    }
  }

  const policyQuery = await store.open(generation.universe, generation.id)
  let policyMs: number
  try {
    const started = performance.now()
    await runAnalysisPolicies({
      query: policyQuery,
      policies: [
        {
          manifest: {
            id: deriveAnalysisId('policy', 'qualification.query-workload', {}),
            version: '1.0.0',
            requiresCapabilities: [],
            inputs: [],
            rules: ['body-page'],
            limits: { page: 100 },
          },
          async evaluate(context) {
            const page = await context.query.facts(
              { namespaces: ['typescript.body'] },
              { limit: 100 },
            )
            return [{
              rule: 'body-page',
              status: 'pass' as const,
              diagnostics: [],
              matched: page.facts.length,
              total: page.total ?? page.facts.length,
            }]
          },
        },
      ],
    })
    policyMs = round(performance.now() - started)
  } finally {
    await policyQuery.dispose()
  }

  return {
    headerDiscoveryMs,
    ...(selectiveHydrationMs === undefined ? {} : { selectiveHydrationMs }),
    ...(headerPointMs === undefined ? {} : { headerPointMs }),
    headerFirstPageMs,
    ...(headerNextPageMs === undefined ? {} : { headerNextPageMs }),
    headerFullScanMs,
    headerFullScanFacts,
    ...(pointMs === undefined ? {} : { pointMs }),
    firstPageMs,
    ...(nextPageMs === undefined ? {} : { nextPageMs }),
    ...(evaluatorIndexMs === undefined ? {} : { evaluatorIndexMs }),
    ...(evaluatorMs === undefined ? {} : { evaluatorMs }),
    policyMs,
  }
}

function sqliteStorageAttribution(file: string): Readonly<Record<string, number>> {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = database
      .prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name')
      .all() as { readonly name: string; readonly bytes: number }[]
    return Object.fromEntries(rows.map((row) => [row.name, row.bytes]))
  } catch {
    return {}
  } finally {
    database.close()
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function scopedTelemetry(
  backend: 'memory' | 'sqlite',
  project = '<store>',
): AnalysisTelemetrySink {
  return (event) => events.push({ ...event, context: { backend, project } })
}

function groupByProject(
  boundaries: readonly NativeModuleBoundary[],
): ReadonlyMap<string, readonly NativeModuleBoundary[]> {
  const grouped = new Map<string, NativeModuleBoundary[]>()
  for (const boundary of boundaries) {
    const values = grouped.get(boundary.project) ?? []
    values.push(boundary)
    grouped.set(boundary.project, values)
  }
  return new Map(
    [...grouped]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([project, values]) => [project, values.sort((left, right) => left.id.localeCompare(right.id))]),
  )
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

function requiredTarget(value: string): SelfHostTargetId {
  if (value !== 'codegraph' && value !== 'kernel') throw new Error('--target must be codegraph or kernel.')
  return value
}

function requiredBackend(value: string): 'memory' | 'sqlite' | 'both' {
  if (value !== 'memory' && value !== 'sqlite' && value !== 'both') {
    throw new Error('--backend must be memory, sqlite, or both.')
  }
  return value
}

function requiredPayloadMaterialization(value: string): 'inline-json' | 'shard-brotli' {
  if (value !== 'inline-json' && value !== 'shard-brotli') {
    throw new Error('--materialization must be inline-json or shard-brotli.')
  }
  return value
}

function optionalCapabilities(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || value === 'all') return undefined
  const capabilities = [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))].sort()
  if (!capabilities.length) throw new Error('--capabilities requires comma-separated native capabilities or all.')
  return capabilities
}

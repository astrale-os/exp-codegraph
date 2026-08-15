import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createMemoryAnalysisStore,
  type AnalysisGenerationId,
  type AnalysisTelemetryEvent,
  type AnalysisTelemetrySink,
  type NativeModuleBoundary,
  type ProjectUniverseId,
} from '../../../analysis/index.ts'
import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'
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

  const memory = createMemoryAnalysisStore({
    maximumRetainedGenerations: 1,
    telemetry: scopedTelemetry('memory'),
  })
  const memoryResults = new Map<string, Awaited<ReturnType<typeof runProject>>>()
  try {
    for (const [project, modules] of selected) {
      memoryResults.set(project, await runProject('memory', project, modules, memory))
    }
  } finally {
    await memory.dispose()
  }

  const sqliteFile = join(temporary, 'profile.sqlite')
  const sqlite = await createSQLiteAnalysisStore({
    file: sqliteFile,
    namespace: `profile-${target}`,
    maximumRetainedGenerations: 1,
    telemetry: scopedTelemetry('sqlite'),
  })
  const sqliteResults = new Map<string, Awaited<ReturnType<typeof runProject>>>()
  try {
    for (const [project, modules] of selected) {
      sqliteResults.set(project, await runProject('sqlite', project, modules, sqlite))
    }
  } finally {
    await sqlite.dispose()
  }

  const projectsResult = [...selected].map(([project, modules]) => {
    const memory = memoryResults.get(project)!
    const sqlite = sqliteResults.get(project)!
    assert.equal(memory.generation, sqlite.generation)
    assert.equal(memory.semanticDigest, sqlite.semanticDigest)
    assert.equal(memory.boundFactDigest, sqlite.boundFactDigest)
    return {
      project,
      modules: modules.length,
      generation: memory.generation,
      universe: memory.universe,
      memoryMs: memory.elapsedMs,
      sqliteMs: sqlite.elapsedMs,
      facts: memory.facts,
      factBytes: memory.factBytes,
      namespaceBytes: memory.namespaceBytes,
      bodyFieldBytes: memory.bodyFieldBytes,
      bodyOccurrenceFieldBytes: memory.bodyOccurrenceFieldBytes,
      semanticDigest: memory.semanticDigest,
      boundFactDigest: memory.boundFactDigest,
    }
  })
  const result = {
    format: 'astrale.codegraph.project-profile',
    version: 1,
    target,
    native: createHash('sha256').update(await readFile(binary)).digest('hex'),
    specifications: specifications.length,
    boundaries: resolution.boundaries.length,
    projects: projectsResult,
    sqliteBytes: (await stat(sqliteFile)).size,
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
      projects: result.projects,
      sqliteBytes: result.sqliteBytes,
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
  })
  try {
    const summary = await summarizeGeneration(target, project, store, analyzed.generation)
    return {
      generation: analyzed.generation.id as AnalysisGenerationId,
      universe: analyzed.generation.universe as ProjectUniverseId,
      elapsedMs: analyzed.elapsedMs,
      facts: summary.facts,
      factBytes: summary.factBytes,
      namespaceBytes: summary.namespaceBytes,
      bodyFieldBytes: summary.bodyFieldBytes,
      bodyOccurrenceFieldBytes: summary.bodyOccurrenceFieldBytes,
      semanticDigest: summary.semanticDigest,
      boundFactDigest: summary.boundFactDigest,
    }
  } finally {
    await analyzed.service.dispose()
  }
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

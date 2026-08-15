import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve, sep } from 'node:path'

import {
  createMemoryAnalysisStore,
  type AnalysisTelemetryEvent,
} from '../../../analysis/index.ts'
import { resolveApplicationModuleBoundaries } from '../../../application/analysis/index.ts'
import {
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from '../../../application/discovery/index.ts'
import { compileSpecificationSnapshots } from '../../../specification/index.ts'
import { analyzeProject } from '../self-host/analyze.ts'

const root = await resolveApplicationRoot(requiredArgument('--root'))
const binary = resolve(requiredArgument('--native-binary'))
const project = argument('--project') ?? 'tsconfig.json'
const changed = argument('--changed') ?? 'analysis/generation/model.ts'
const temporary = await mkdtemp(`${tmpdir()}${sep}codegraph-affected-project-`)
const mirror = resolve(temporary, 'mirror')
const events: AnalysisTelemetryEvent[] = []

try {
  await cp(root, mirror, {
    recursive: true,
    verbatimSymlinks: true,
    filter(source) {
      const path = relative(root, source)
      if (!path) return true
      const segments = path.split(sep)
      return !['.cache', '.git', 'node_modules', 'coverage', 'dist', 'evidence'].some(
        (value) => segments.includes(value),
      )
    },
  })
  await symlink(resolve(root, 'node_modules'), resolve(mirror, 'node_modules'), 'dir')
  const directories = await discoverSpecificationDirectories(mirror)
  const specifications = await compileSpecificationSnapshots(mirror, directories)
  const resolution = await resolveApplicationModuleBoundaries(mirror, specifications)
  assert.deepEqual(resolution.diagnostics, [])
  const modules = resolution.boundaries.filter((boundary) => boundary.project === project)
  if (!modules.length) throw new Error(`No module boundaries use ${project}.`)

  const changedFile = resolve(mirror, changed)
  const changedBefore = await readFile(changedFile, 'utf8')
  const changedAfter = insertBodyComment(changedBefore)

  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
  const baseline = await analyzeProject({
    target: 'codegraph', root: mirror, project, modules, binary, store,
    telemetry: (event) => events.push(event),
  })
  process.stderr.write(`cold baseline ${baseline.elapsedMs} ms\n`)
  let incremental: Awaited<ReturnType<typeof baseline.service.refresh>>
  let incrementalMs = 0
  try {
    await writeFile(changedFile, changedAfter, 'utf8')
    const started = performance.now()
    incremental = await baseline.service.refresh({ changed: [changed] })
    incrementalMs = performance.now() - started
    process.stderr.write(`incremental ${round(incrementalMs)} ms\n`)
  } finally {
    await baseline.service.dispose()
  }
  assert(incremental!.transaction)

  const coldStore = createMemoryAnalysisStore()
  const cold = await analyzeProject({
    target: 'codegraph', root: mirror, project, modules, binary, store: coldStore,
  })
  process.stderr.write(`cold oracle ${cold.elapsedMs} ms\n`)
  try {
    assert.equal(incremental!.generation.id, cold.generation.id)
    const native = [...events].reverse().find(
      (event) => event.component === 'native' && event.phase === 'refresh.total',
    )
    const sourceProjection = [...events].reverse().find(
      (event) => event.component === 'native'
        && event.phase === 'projection.sources',
    )
    const nativeWire = [...events].reverse().find(
      (event) => event.component === 'native'
        && event.phase === 'transport.serialize-and-write',
    )
    process.stdout.write(`${JSON.stringify({
      format: 'astrale.codegraph.affected-project-experiment',
      version: 1,
      project,
      changed,
      sourcesProjected: sourceProjection?.metrics?.sources,
      incrementalMs: round(incrementalMs),
      coldMs: cold.elapsedMs,
      speedup: round(cold.elapsedMs / incrementalMs),
      manifestShards: incremental!.transaction.manifest.length,
      upsertShards: incremental!.transaction.upserts.length,
      deleteShards: incremental!.transaction.deletes.length,
      generation: incremental!.generation.id,
      exactColdEquality: true,
      nativeWire: nativeWire?.metrics,
      native: native?.metrics,
    }, null, 2)}\n`)
  } finally {
    await cold.service.dispose()
    await store.dispose()
    await coldStore.dispose()
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function insertBodyComment(source: string): string {
  const match = /\bfunction\s+[A-Za-z_$][\w$]*[^\n{]*\{/u.exec(source)
  if (!match) throw new Error('Selected source has no ordinary function body for the probe.')
  const offset = match.index + match[0].length
  return `${source.slice(0, offset)}\n  // codegraph affected-shard private-body probe${source.slice(offset)}`
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

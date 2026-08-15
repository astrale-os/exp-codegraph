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
import { stableJson } from '../../../analysis/identity/model.ts'
import { analyzeProject } from '../self-host/analyze.ts'
import type { SelfHostTargetId } from '../self-host/model.ts'

const target = requiredTarget(argument('--target') ?? 'codegraph')
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
  const directories = await discoverSpecificationDirectories(mirror, {
    ...(target === 'kernel' ? { exclude: ['spec'] } : {}),
  })
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
    target, root: mirror, project, modules, binary, store,
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
    target, root: mirror, project, modules, binary, store: coldStore,
  })
  process.stderr.write(`cold oracle ${cold.elapsedMs} ms\n`)
  try {
    if (incremental!.generation.id !== cold.generation.id) {
      process.stderr.write(`${JSON.stringify(await difference(
        store,
        incremental!.generation.universe,
        coldStore,
        cold.generation.universe,
      ), null, 2)}\n`)
    }
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
    const phases = Object.fromEntries(
      [
        'compiler.update',
        'projection.diagnostics',
        'projection.modules',
        'projection.sources',
        'projection.symbol-discovery',
        'projection.symbols',
        'projection.occurrences',
        'projection.bodies',
        'projection.total',
        'transaction.materialize',
      ].flatMap((phase) => {
        const event = [...events].reverse().find(
          (candidate) => candidate.component === 'native' && candidate.phase === phase,
        )
        return event ? [[phase, { durationNs: event.durationNs, metrics: event.metrics }]] : []
      }),
    )
    process.stdout.write(`${JSON.stringify({
      format: 'astrale.codegraph.affected-project-experiment',
      version: 1,
      target,
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
      phases,
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

async function difference(
  leftStore: import('../../../analysis/index.ts').AnalysisStore,
  leftUniverse: import('../../../analysis/index.ts').ProjectUniverseId,
  rightStore: import('../../../analysis/index.ts').AnalysisStore,
  rightUniverse: import('../../../analysis/index.ts').ProjectUniverseId,
) {
  const [leftQuery, rightQuery] = await Promise.all([
    leftStore.open(leftUniverse),
    rightStore.open(rightUniverse),
  ])
  try {
    const left = new Map<string, Record<string, unknown>>()
    const right = new Map<string, Record<string, unknown>>()
    const leftSummary = new Map<string, string>()
    const rightSummary = new Map<string, string>()
    const leftBySubject = new Map<string, { readonly id: string; readonly value: Record<string, unknown> }>()
    const rightBySubject = new Map<string, { readonly id: string; readonly value: Record<string, unknown> }>()
    for await (const fact of leftQuery.export()) {
      const summary = `${fact.namespace}:${fact.kind}:${fact.subject}`
      const value = { ...fact, id: '<fact>', generation: '<generation>' }
      left.set(fact.id, value)
      leftSummary.set(fact.id, summary)
      leftBySubject.set(summary, { id: fact.id, value })
    }
    for await (const fact of rightQuery.export()) {
      const summary = `${fact.namespace}:${fact.kind}:${fact.subject}`
      const value = { ...fact, id: '<fact>', generation: '<generation>' }
      right.set(fact.id, value)
      rightSummary.set(fact.id, summary)
      rightBySubject.set(summary, { id: fact.id, value })
    }
    return {
      incrementalOnly: [...left.keys()]
        .filter((id) => !right.has(id) || stableJson(right.get(id)) !== stableJson(left.get(id)))
        .slice(0, 20)
        .map((id) => ({ id, fact: leftSummary.get(id) })),
      coldOnly: [...right.keys()]
        .filter((id) => !left.has(id) || stableJson(left.get(id)) !== stableJson(right.get(id)))
        .slice(0, 20)
        .map((id) => ({ id, fact: rightSummary.get(id) })),
      changed: [...leftBySubject]
        .flatMap(([subject, leftFact]) => {
          const rightFact = rightBySubject.get(subject)
          if (!rightFact || leftFact.id === rightFact.id) return []
          return [{
            subject,
            incremental: leftFact.id,
            cold: rightFact.id,
            difference: firstDifference(leftFact.value, rightFact.value),
          }]
        })
        .slice(0, 20),
    }
  } finally {
    await rightQuery.dispose()
    await leftQuery.dispose()
  }
}

function firstDifference(
  left: unknown,
  right: unknown,
  path = '$',
): { readonly path: string; readonly incremental: unknown; readonly cold: unknown } | undefined {
  if (Object.is(left, right)) return undefined
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return { path: `${path}.length`, incremental: left.length, cold: right.length }
    }
    for (let index = 0; index < left.length; index++) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`)
      if (difference) return difference
    }
    return undefined
  } else if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`)
      if (difference) return difference
    }
    return undefined
  }
  return { path, incremental: left, cold: right }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function requiredTarget(value: string): SelfHostTargetId {
  if (value !== 'codegraph' && value !== 'kernel') {
    throw new Error('--target must be codegraph or kernel.')
  }
  return value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

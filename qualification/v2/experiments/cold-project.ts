import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
import type { SelfHostTargetId } from '../self-host/model.ts'

const target = requiredTarget(argument('--target') ?? 'codegraph')
const root = await resolveApplicationRoot(requiredArgument('--root'))
const binary = resolve(requiredArgument('--native-binary'))
const project = argument('--project') ?? 'tsconfig.json'
const output = argument('--output')
const events: AnalysisTelemetryEvent[] = []

const directories = await discoverSpecificationDirectories(root, {
  ...(target === 'kernel' ? { exclude: ['spec'] } : {}),
})
const specifications = await compileSpecificationSnapshots(root, directories)
const resolution = await resolveApplicationModuleBoundaries(root, specifications)
assert.deepEqual(resolution.diagnostics, [])
const modules = resolution.boundaries.filter((boundary) => boundary.project === project)
if (!modules.length) throw new Error(`No module boundaries use ${project}.`)

const store = createMemoryAnalysisStore({
  maximumRetainedGenerations: 1,
  telemetry: (event) => events.push(event),
})
try {
  const analyzed = await analyzeProject({
    target,
    root,
    project,
    modules,
    binary,
    store,
    telemetry: (event) => events.push(event),
  })
  try {
    const result = {
      format: 'astrale.codegraph.cold-project-attribution',
      version: 1,
      target,
      project,
      nativePublication: 'commit-late',
      nativeSha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
      specifications: specifications.length,
      boundaries: resolution.boundaries.length,
      modules: modules.length,
      elapsedMs: analyzed.elapsedMs,
      generation: analyzed.generation.id,
      universe: analyzed.generation.universe,
      sourceManifest: analyzed.generation.sourceManifest,
      events: events.filter((event) =>
        event.component === 'native' || event.component === 'memory-store'),
    }
    const serialized = `${JSON.stringify(result, null, 2)}\n`
    if (output) {
      const destination = resolve(output)
      await writeFile(destination, serialized, 'utf8')
      process.stdout.write(`${JSON.stringify({
        format: result.format,
        target,
        elapsedMs: result.elapsedMs,
        generation: result.generation,
        output: destination,
      }, null, 2)}\n`)
    } else {
      process.stdout.write(serialized)
    }
  } finally {
    await analyzed.service.dispose()
  }
} finally {
  await store.dispose()
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
  if (value !== 'codegraph' && value !== 'kernel') {
    throw new Error('--target must be codegraph or kernel.')
  }
  return value
}

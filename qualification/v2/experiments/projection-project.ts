import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  createMemoryAnalysisStore,
  type AnalysisTelemetryEvent,
  type Fact,
} from '../../../analysis/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'
import { TYPESCRIPT_FACT_NAMESPACES } from '../../../analysis/typescript/index.ts'
import { resolveApplicationModuleBoundaries } from '../../../application/analysis/index.ts'
import {
  discoverSpecificationDirectories,
  resolveApplicationRoot,
} from '../../../application/discovery/index.ts'
import { compileSpecificationSnapshots } from '../../../specification/index.ts'
import { analyzeProject, SELF_HOST_NATIVE_CAPABILITIES } from '../self-host/analyze.ts'
import type { SelfHostTargetId } from '../self-host/model.ts'

const target = requiredTarget(argument('--target') ?? 'codegraph')
const root = await resolveApplicationRoot(requiredArgument('--root'))
const binary = resolve(requiredArgument('--native-binary'))
const project = argument('--project') ?? 'tsconfig.json'
const output = argument('--output')
const selectedNamespaces = [
  TYPESCRIPT_FACT_NAMESPACES.module,
  TYPESCRIPT_FACT_NAMESPACES.body,
] as const
const semanticPhases = new Set([
  'projection.project',
  'projection.diagnostics',
  'projection.modules',
  'projection.sources',
  'projection.symbol-discovery',
  'projection.symbols',
  'projection.occurrences',
  'projection.bodies',
])

const directories = await discoverSpecificationDirectories(root, {
  ...(target === 'kernel' ? { exclude: ['spec'] } : {}),
})
const specifications = await compileSpecificationSnapshots(root, directories)
const resolution = await resolveApplicationModuleBoundaries(root, specifications)
assert.deepEqual(resolution.diagnostics, [])
const modules = resolution.boundaries.filter((boundary) => boundary.project === project)
if (!modules.length) throw new Error(`No module boundaries use ${project}.`)

const full = await analyze(SELF_HOST_NATIVE_CAPABILITIES)
const selections = []
for (const namespace of selectedNamespaces) {
  const selected = await analyze([namespace])
  const differences = compare(full.facts.get(namespace), selected.facts.get(namespace))
  selections.push({
    namespace,
    elapsedMs: selected.elapsedMs,
    generation: selected.generation,
    universe: selected.universe,
    sourceManifest: selected.sourceManifest,
    facts: selected.facts.get(namespace)?.size ?? 0,
    digest: digestFacts(selected.facts.get(namespace)),
    semanticPhases: selected.semanticPhases,
    unrequestedSemanticPhases: selected.semanticPhases.filter(
      (phase) => phase !== expectedPhase(namespace),
    ),
    exactSelectedFacts: differences.length === 0,
    differences,
  })
}

const result = {
  format: 'astrale.codegraph.projection-project-equivalence',
  version: 1,
  target,
  project,
  specifications: specifications.length,
  boundaries: resolution.boundaries.length,
  modules: modules.length,
  full: {
    elapsedMs: full.elapsedMs,
    generation: full.generation,
    universe: full.universe,
    sourceManifest: full.sourceManifest,
    semanticPhases: full.semanticPhases,
    namespaceDigests: Object.fromEntries(
      selectedNamespaces.map((namespace) => [namespace, digestFacts(full.facts.get(namespace))]),
    ),
  },
  selections,
  exactSelectedFacts: selections.every((selection) => selection.exactSelectedFacts),
  stableUniverse: selections.every((selection) => selection.universe === full.universe),
  stableSourceManifest: selections.every(
    (selection) => selection.sourceManifest === full.sourceManifest,
  ),
  unrequestedSemanticPhasesExecuted: selections.reduce(
    (count, selection) => count + selection.unrequestedSemanticPhases.length,
    0,
  ),
}
const serialized = `${JSON.stringify(result, null, 2)}\n`
if (output) {
  const destination = resolve(output)
  await writeFile(destination, serialized, 'utf8')
  process.stdout.write(`${JSON.stringify({
    format: result.format,
    target,
    exactSelectedFacts: result.exactSelectedFacts,
    stableUniverse: result.stableUniverse,
    stableSourceManifest: result.stableSourceManifest,
    unrequestedSemanticPhasesExecuted: result.unrequestedSemanticPhasesExecuted,
    output: destination,
  }, null, 2)}\n`)
} else {
  process.stdout.write(serialized)
}
if (process.argv.includes('--require-exact')) {
  assert.equal(result.exactSelectedFacts, true)
  assert.equal(result.stableUniverse, true)
  assert.equal(result.stableSourceManifest, true)
  assert.equal(result.unrequestedSemanticPhasesExecuted, 0)
}

async function analyze(capabilities: readonly string[]) {
  const events: AnalysisTelemetryEvent[] = []
  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
  const analyzed = await analyzeProject({
    target,
    root,
    project,
    modules,
    binary,
    store,
    capabilities,
    telemetry: (event) => events.push(event),
  })
  try {
    const query = await store.open(analyzed.generation.universe, analyzed.generation.id)
    try {
      const facts = new Map<string, Map<string, string>>()
      for (const namespace of selectedNamespaces) {
        const values = new Map<string, string>()
        for await (const fact of query.export({ namespaces: [namespace] })) {
          const key = `${fact.kind}\0${fact.subject}`
          if (values.has(key)) throw new Error(`Duplicate projection comparison key ${key}.`)
          values.set(key, stableJson(portableFact(fact)))
        }
        facts.set(namespace, values)
      }
      return {
        elapsedMs: analyzed.elapsedMs,
        generation: analyzed.generation.id,
        universe: analyzed.generation.universe,
        sourceManifest: analyzed.generation.sourceManifest,
        facts,
        semanticPhases: [...new Set(
          events
            .filter((event) => event.component === 'native' && semanticPhases.has(event.phase))
            .map((event) => event.phase),
        )].sort(),
      }
    } finally {
      await query.dispose()
    }
  } finally {
    await analyzed.service.dispose()
    await store.dispose()
  }
}

function compare(
  expected: ReadonlyMap<string, string> | undefined,
  actual: ReadonlyMap<string, string> | undefined,
) {
  const left = expected ?? new Map()
  const right = actual ?? new Map()
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort()
  return keys.flatMap((key) => {
    const before = left.get(key)
    const after = right.get(key)
    if (before === after) return []
    return [{
      key,
      expectedDigest: before ? digest(before) : null,
      actualDigest: after ? digest(after) : null,
      firstDifference: firstDifference(
        before === undefined ? undefined : withoutFactIdentity(JSON.parse(before)),
        after === undefined ? undefined : withoutFactIdentity(JSON.parse(after)),
      ),
    }]
  }).slice(0, 10)
}

function withoutFactIdentity(value: unknown): unknown {
  return isRecord(value) ? { ...value, id: '<fact>' } : value
}

function firstDifference(left: unknown, right: unknown, path = '$'): unknown {
  if (Object.is(left, right)) return undefined
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return { path: `${path}.length`, expected: left.length, actual: right.length }
    for (let index = 0; index < left.length; index++) {
      const value = firstDifference(left[index], right[index], `${path}[${index}]`)
      if (value) return value
    }
    return undefined
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      const value = firstDifference(left[key], right[key], `${path}.${key}`)
      if (value) return value
    }
    return undefined
  }
  return { path, expected: left, actual: right }
}

function digestFacts(values: ReadonlyMap<string, string> | undefined): string {
  const hash = createHash('sha256')
  for (const [key, value] of [...(values ?? new Map())].sort(([left], [right]) =>
    left.localeCompare(right))) {
    hash.update(`${key.length}:${key}${value.length}:${value}\n`)
  }
  return hash.digest('hex')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function portableFact(fact: Fact): Omit<Fact, 'generation'> {
  const { generation: _generation, ...portable } = fact
  return portable
}

function expectedPhase(namespace: string): string {
  if (namespace === TYPESCRIPT_FACT_NAMESPACES.module) return 'projection.modules'
  if (namespace === TYPESCRIPT_FACT_NAMESPACES.body) return 'projection.bodies'
  throw new Error(`No selected phase for ${namespace}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

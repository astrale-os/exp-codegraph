import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createMemoryAnalysisStore,
  createProcessNativeAnalysisSessionFactory,
  type AnalysisTelemetryEvent,
  type Fact,
  type FactShardReference,
} from '../../../analysis/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'
import {
  createTypeScriptAnalysisService,
  TYPESCRIPT_FACT_NAMESPACES,
  TYPESCRIPT_FACT_PAYLOAD_CODECS,
} from '../../../analysis/typescript/index.ts'

const binary = resolve(requiredArgument('--native-binary'))
const output = argument('--output')
const temporary = await mkdtemp(join(tmpdir(), 'codegraph-projection-plan-'))
const namespaces = Object.values(TYPESCRIPT_FACT_NAMESPACES).sort()

const phases = new Map<string, readonly string[]>([
  [TYPESCRIPT_FACT_NAMESPACES.project, ['projection.project']],
  [TYPESCRIPT_FACT_NAMESPACES.diagnostic, ['projection.diagnostics']],
  [TYPESCRIPT_FACT_NAMESPACES.module, ['projection.modules']],
  [TYPESCRIPT_FACT_NAMESPACES.source, ['projection.sources']],
  [TYPESCRIPT_FACT_NAMESPACES.symbol, ['projection.symbol-discovery', 'projection.symbols']],
  [TYPESCRIPT_FACT_NAMESPACES.occurrence, ['projection.occurrences']],
  [TYPESCRIPT_FACT_NAMESPACES.body, ['projection.bodies']],
])
const semanticPhases = new Set([...phases.values()].flat())

try {
  await mkdir(join(temporary, 'src'), { recursive: true })
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({ name: '@fixture/projection-plan', type: 'module' }),
  )
  await writeFile(
    join(temporary, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
      },
      include: ['src/**/*.ts'],
    }),
  )
  await writeFile(
    join(temporary, 'src/index.ts'),
    `export const result = call('value')

export function call(value: string): string {
  return value.toUpperCase()
}

interface ExpectedTypeParameter { readonly name: string }
interface ExpectedDeclaration { readonly typeParameters?: readonly ExpectedTypeParameter[] }

function compare(
  expected: ExpectedDeclaration,
  options?: { readonly expectedParameters?: NonNullable<ExpectedDeclaration['typeParameters']> },
): void {
  void expected
  void options
}

export function compareAlias(expected: ExpectedDeclaration): void {
  compare(expected, { expectedParameters: expected.typeParameters })
}
`,
  )

  const full = await analyze(namespaces)
  const results = []
  for (const namespace of namespaces) {
    const selected = await analyze([namespace])
    assert.equal(selected.universe, full.universe)
    assert.deepEqual(selected.namespaces, [namespace])
    assert.deepEqual(selected.facts, full.facts.filter((fact) => fact.namespace === namespace))
    assert.deepEqual(
      selected.manifest,
      full.manifest.filter((reference) => reference.namespace === namespace),
    )
    assert.deepEqual(selected.semanticPhases, [...(phases.get(namespace) ?? [])].sort())
    results.push({
      namespace,
      facts: selected.facts.length,
      shards: selected.manifest.length,
      stages: selected.semanticPhases,
      durationMs: selected.durationMs,
    })
  }
  const changedBoundary = await analyze([TYPESCRIPT_FACT_NAMESPACES.module], 'renamed-fixture')
  const originalBoundary = await analyze([TYPESCRIPT_FACT_NAMESPACES.module])
  assert.equal(changedBoundary.universe, originalBoundary.universe)
  assert.notEqual(changedBoundary.generation, originalBoundary.generation)
  assert.notDeepEqual(changedBoundary.facts, originalBoundary.facts)

  const result = {
    format: 'astrale.codegraph.projection-plan-equivalence',
    version: 1,
    full: {
      facts: full.facts.length,
      shards: full.manifest.length,
      durationMs: full.durationMs,
      semanticDigest: digest(full.facts),
    },
    capabilities: results,
    exactNamespaceProjection: true,
    stableUniverseAcrossProjectionPlans: true,
    moduleBoundaryChangesGenerationOnly: true,
    unrequestedSemanticStagesExecuted: 0,
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (output) {
    const destination = resolve(output)
    await writeFile(destination, serialized, 'utf8')
    process.stdout.write(`${JSON.stringify({
      format: result.format,
      exactNamespaceProjection: result.exactNamespaceProjection,
      stableUniverseAcrossProjectionPlans: result.stableUniverseAcrossProjectionPlans,
      unrequestedSemanticStagesExecuted: result.unrequestedSemanticStagesExecuted,
      output: destination,
    }, null, 2)}\n`)
  } else {
    process.stdout.write(serialized)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function analyze(capabilities: readonly string[], moduleName = 'fixture'): Promise<{
  readonly universe: string
  readonly generation: string
  readonly facts: readonly Omit<Fact, 'generation'>[]
  readonly manifest: readonly FactShardReference[]
  readonly namespaces: readonly string[]
  readonly semanticPhases: readonly string[]
  readonly durationMs: number
}> {
  const events: AnalysisTelemetryEvent[] = []
  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 1 })
  const sessions = createProcessNativeAnalysisSessionFactory({
    command: binary,
    payloadCodecs: TYPESCRIPT_FACT_PAYLOAD_CODECS,
    telemetry: (event) => events.push(event),
  })
  const service = await createTypeScriptAnalysisService({
    project: {
      root: temporary,
      config: 'tsconfig.json',
      capabilities,
      modules: [{
        id: 'fixture',
        name: moduleName,
        project: 'tsconfig.json',
        root: 'src',
        entrypoint: 'src/index.ts',
        facades: [],
        aliases: [],
        internals: [],
      }],
    },
    sessions,
    store,
  })
  try {
    const started = performance.now()
    const refreshed = await service.refresh()
    const durationMs = round(performance.now() - started)
    const query = await store.open(refreshed.generation.universe, refreshed.generation.id)
    try {
      const facts: Fact[] = []
      for await (const fact of query.export()) facts.push(fact)
      const plan = events.find(
        (event) => event.component === 'native' && event.phase === 'projection.plan',
      )
      assert.equal(plan?.metrics?.capabilities, [...capabilities].sort().join(','))
      return {
        universe: refreshed.generation.universe,
        generation: refreshed.generation.id,
        facts: facts.map(portableFact).sort(byPortableFact),
        manifest: [...await query.manifest()].sort(byManifest),
        namespaces: [...new Set((await query.manifest()).map((reference) => reference.namespace))].sort(),
        semanticPhases: [...new Set(
          events
            .filter((event) => event.component === 'native' && semanticPhases.has(event.phase))
            .map((event) => event.phase),
        )].sort(),
        durationMs,
      }
    } finally {
      await query.dispose()
    }
  } finally {
    await service.dispose()
    await store.dispose()
  }
}

function portableFact(fact: Fact): Omit<Fact, 'generation'> {
  const { generation: _generation, ...portable } = fact
  return portable
}

function byPortableFact(
  left: Omit<Fact, 'generation'>,
  right: Omit<Fact, 'generation'>,
): number {
  return left.id.localeCompare(right.id)
}

function byManifest(left: FactShardReference, right: FactShardReference): number {
  return left.key.localeCompare(right.key)
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

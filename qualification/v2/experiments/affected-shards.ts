import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  createMemoryAnalysisStore,
  createProcessNativeAnalysisSessionFactory,
  type AnalysisStore,
  type AnalysisTelemetryEvent,
  type Fact,
  type ProjectUniverseId,
} from '../../../analysis/index.ts'
import { createTypeScriptAnalysisService } from '../../../analysis/typescript/index.ts'
import { stableJson } from '../../../analysis/identity/model.ts'

const fixture = resolve(import.meta.dirname, '../ttsc/fixtures/adversarial')
const binary = resolve(requiredArgument('--native-binary'))
const output = argument('--output')
const temporary = await mkdtemp(join(tmpdir(), 'codegraph-affected-shards-'))
const capabilities = [
  'astrale.typescript.module',
  'typescript.body',
  'typescript.diagnostic',
  'typescript.occurrence',
  'typescript.project',
  'typescript.source',
  'typescript.symbol',
] as const
const modules = [{
  id: 'fixture.sdk', name: 'FixtureSdk', project: 'tsconfig.json', root: 'src/sdk',
  entrypoint: 'src/sdk/index.ts', facades: [], aliases: [], internals: [],
}, {
  id: 'fixture.app', name: 'FixtureApp', project: 'tsconfig.json', root: 'src',
  entrypoint: 'src/cases.ts', facades: [], aliases: [], internals: ['src/fake.ts'],
}] as const

try {
  const results = []
  results.push(await scenario('private-body', ['src/cases.ts'], async (root) => {
    await replace(root, 'src/cases.ts', "name: 'known'", "name: 'known-affected-edit'")
  }, {
    mode: 'resident-apply', minimumSources: 1, maximumSources: 1,
    minimumModules: 1, maximumModules: 1,
  }))
  results.push(await scenario('private-diagnostic', ['src/cases.ts'], async (root) => {
    await replace(
      root,
      'src/cases.ts',
      "export function aliasCase(): MutationOptions {\n  return mutation",
      "export function aliasCase(): MutationOptions {\n  const mismatch: string = 1\n  void mismatch\n  return mutation",
    )
  }, {
    mode: 'resident-apply', minimumSources: 1, maximumSources: 1,
    minimumModules: 1, maximumModules: 1, diagnosticsProjected: true,
  }))
  results.push(await scenario('computed-dependency', ['src/cases.ts'], async (root) => {
    await replace(
      root,
      'src/cases.ts',
      "export function unknownCase(): MutationOptions {\n  return mutation",
      "export function unknownCase(): MutationOptions {\n  void import(runtimeName)\n  return mutation",
    )
  }, {
    mode: 'resident-apply', minimumSources: 1, maximumSources: 1,
    minimumModules: 2,
  }))
  results.push(await scenario('public-shape', ['src/sdk/builder.ts'], async (root) => {
    await replace(
      root,
      'src/sdk/builder.ts',
      '>(options: Options): Options {',
      '>(options: Options, marker?: string): Options {\n  void marker',
    )
  }, { mode: 'resident-apply', minimumSources: 2, minimumModules: 2 }))
  results.push(await scenario('import-graph', ['src/cases.ts'], async (root) => {
    await replace(
      root,
      'src/cases.ts',
      "import { defineMutation as mutation, type MutationOptions } from '@fixture/sdk'",
      "import { defineMutation as mutation, type MutationOptions } from '@fixture/sdk'\nimport type { SurfaceOptions } from './sdk/builder.ts'\nvoid (undefined as SurfaceOptions | undefined)",
    )
  }, { mode: 'resident-full' }))
  results.push(await scenario('ambient-scope', ['src/cases.ts'], async (root) => {
    const file = join(root, 'src/cases.ts')
    const source = await readFile(file, 'utf8')
    await writeFile(file, `${source}\ndeclare global { interface CodegraphProbe { readonly value: string } }\n`, 'utf8')
  }, { mode: 'resident-full' }))
  results.push(await scenario('create', ['src/created.ts'], async (root) => {
    await writeFile(join(root, 'src/created.ts'), 'export const created = true\n', 'utf8')
  }, { mode: 'resident-full', universeChanged: true }))
  results.push(await scenario('delete', ['src/fake.ts'], async (root) => {
    await rm(join(root, 'src/fake.ts'))
  }, { mode: 'resident-full', universeChanged: true }))
  results.push(await scenario(
    'rename',
    ['src/fake.ts', 'src/fake-renamed.ts'],
    async (root) => rename(join(root, 'src/fake.ts'), join(root, 'src/fake-renamed.ts')),
    { mode: 'resident-full', universeChanged: true },
  ))
  results.push(await scenario('config', ['tsconfig.json'], async (root) => {
    const file = join(root, 'tsconfig.json')
    await writeFile(file, `${(await readFile(file, 'utf8')).trimEnd()}\n\n`, 'utf8')
  }, { mode: 'resident-full', universeChanged: true }))
  results.push(await commitReplayScenario())

  const result = {
    format: 'astrale.codegraph.affected-shards-experiment',
    version: 2,
    exactColdEquality: results.every((result) => result.exactColdEquality),
    results,
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (output) {
    const destination = resolve(output)
    await writeFile(destination, serialized, 'utf8')
    process.stdout.write(`${JSON.stringify({
      format: result.format,
      exactColdEquality: result.exactColdEquality,
      scenarios: result.results.length,
      output: destination,
    }, null, 2)}\n`)
  } else {
    process.stdout.write(serialized)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function commitReplayScenario() {
  const project = join(temporary, 'commit-replay')
  await cp(fixture, project, { recursive: true })
  const underlying = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
  let rejectCommit = false
  const store: AnalysisStore = {
    current: underlying.current.bind(underlying),
    open: underlying.open.bind(underlying),
    snapshotSet: underlying.snapshotSet.bind(underlying),
    dispose: underlying.dispose.bind(underlying),
    async commit(transaction, options) {
      if (rejectCommit) {
        rejectCommit = false
        throw new Error('injected application-store failure')
      }
      await underlying.commit(transaction, options)
    },
  }
  const service = await open(project, store)
  let recovered: Awaited<ReturnType<typeof service.refresh>>
  try {
    await service.refresh()
    await replace(project, 'src/cases.ts', "name: 'known'", "name: 'known-replayed'")
    rejectCommit = true
    await assert.rejects(
      service.refresh({ changed: ['src/cases.ts'] }),
      /injected application-store failure/u,
    )
    recovered = await service.refresh()
  } finally {
    await service.dispose()
  }
  const coldStore = createMemoryAnalysisStore()
  const coldService = await open(project, coldStore)
  try {
    const cold = await coldService.refresh()
    assert.equal(recovered!.generation.id, cold.generation.id)
    assert.deepEqual(
      await exportFacts(store, recovered!.generation.universe),
      await exportFacts(coldStore, cold.generation.universe),
    )
  } finally {
    await coldService.dispose()
    await underlying.dispose()
    await coldStore.dispose()
  }
  return {
    name: 'commit-replay',
    exactColdEquality: true,
    replayedAfterStoreFailure: true,
  }
}

async function scenario(
  name: string,
  changed: readonly string[],
  mutate: (root: string) => Promise<void>,
  expected: {
    readonly mode: 'resident-apply' | 'resident-full'
    readonly minimumSources?: number
    readonly maximumSources?: number
    readonly minimumModules?: number
    readonly maximumModules?: number
    readonly diagnosticsProjected?: boolean
    readonly universeChanged?: boolean
  },
) {
  const project = join(temporary, name)
  await cp(fixture, project, { recursive: true })
  const events: AnalysisTelemetryEvent[] = []
  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
  const service = await open(project, store, events)
  let baseline: Awaited<ReturnType<typeof service.refresh>>
  let incremental: Awaited<ReturnType<typeof service.refresh>>
  let incrementalMs = 0
  try {
    baseline = await service.refresh()
    await mutate(project)
    const started = performance.now()
    incremental = await service.refresh({ changed })
    incrementalMs = performance.now() - started
  } finally {
    await service.dispose()
  }
  assert(incremental!.transaction)
  const compiler = [...events].reverse().find(
    (entry) => entry.component === 'native' && entry.phase === 'compiler.update',
  )
  assert.equal(compiler?.metrics?.mode, expected.mode)
  const projection = [...events].reverse().find(
    (entry) => entry.component === 'native'
      && entry.phase === 'projection.sources',
  )
  const projected = Number(projection?.metrics?.sources)
  if (expected.minimumSources !== undefined) assert(projected >= expected.minimumSources)
  if (expected.maximumSources !== undefined) assert(projected <= expected.maximumSources)
  const moduleProjection = [...events].reverse().find(
    (entry) => entry.component === 'native'
      && entry.phase === 'projection.modules',
  )
  const projectedModules = Number(moduleProjection?.metrics?.shards)
  if (expected.minimumModules !== undefined) assert(projectedModules >= expected.minimumModules)
  if (expected.maximumModules !== undefined) assert(projectedModules <= expected.maximumModules)
  const diagnosticProjection = [...events].reverse().find(
    (entry) => entry.component === 'native'
      && entry.phase === 'projection.diagnostics',
  )
  if (expected.diagnosticsProjected !== undefined) {
    assert.equal(Boolean(diagnosticProjection), expected.diagnosticsProjected)
  }
  if (expected.universeChanged) assert.notEqual(incremental!.generation.universe, baseline!.generation.universe)

  const coldStore = createMemoryAnalysisStore()
  const coldService = await open(project, coldStore)
  let cold: Awaited<ReturnType<typeof coldService.refresh>>
  let coldMs = 0
  try {
    const started = performance.now()
    cold = await coldService.refresh()
    coldMs = performance.now() - started
  } finally {
    await coldService.dispose()
  }
  assert.equal(incremental!.generation.id, cold!.generation.id)
  assert.deepEqual(
    await exportFacts(store, incremental!.generation.universe),
    await exportFacts(coldStore, cold!.generation.universe),
  )
  const roundtrip = [...events].reverse().find(
    (entry) => entry.component === 'transport'
      && entry.phase === 'request.roundtrip'
      && entry.metrics?.responseKind === 'delta',
  )
  const nativeWire = [...events].reverse().find(
    (entry) => entry.component === 'native' && entry.phase === 'transport.serialize-and-write',
  )
  await store.dispose()
  await coldStore.dispose()
  return {
    name,
    mode: expected.mode,
    projectedSources: projected,
    projectedModules,
    diagnosticsProjected: Boolean(diagnosticProjection),
    incrementalMs: round(incrementalMs),
    coldMs: round(coldMs),
    manifestShards: incremental!.transaction.manifest.length,
    upsertShards: incremental!.transaction.upserts.length,
    deleteShards: incremental!.transaction.deletes.length,
    transport: roundtrip?.metrics,
    nativeWire: nativeWire?.metrics,
    exactColdEquality: true,
  }
}

async function open(
  root: string,
  store: AnalysisStore,
  events?: AnalysisTelemetryEvent[],
) {
  return createTypeScriptAnalysisService({
    project: { root, config: 'tsconfig.json', capabilities, modules },
    sessions: createProcessNativeAnalysisSessionFactory({
      command: binary,
      ...(events ? { telemetry: (event) => events.push(event) } : {}),
    }),
    store,
  })
}

async function exportFacts(store: AnalysisStore, universe: ProjectUniverseId): Promise<readonly Fact[]> {
  const query = await store.open(universe)
  try {
    const values: Fact[] = []
    for await (const fact of query.export()) values.push(fact)
    return values.sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
  } finally {
    await query.dispose()
  }
}

async function replace(root: string, path: string, before: string, after: string): Promise<void> {
  const file = join(root, path)
  const source = await readFile(file, 'utf8')
  const changed = source.replace(before, after)
  assert.notEqual(changed, source, `${path} mutation did not match`)
  await writeFile(file, changed, 'utf8')
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

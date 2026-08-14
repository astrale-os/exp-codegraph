import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import type {
  ObservedDeclaration,
  TypeScriptDependencyFact,
} from '../../../analysis/typescript/index.ts'

import {
  createProcessNativeAnalysisSessionFactory,
  deriveAnalysisId,
  type AnalysisStore,
  type ProjectUniverseId,
} from '../../../analysis/index.ts'
import { createMemoryAnalysisStore } from '../../../analysis/memory/index.ts'
import { validateFunctionBodyIR } from '../../../analysis/typescript/body/index.ts'
import { typeScriptDependencyIdentity } from '../../../analysis/typescript/index.ts'
import { createTypeScriptAnalysisService } from '../../../analysis/typescript/index.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const qualificationRoot = resolve(import.meta.dirname)
const fixtureSource = resolve(qualificationRoot, 'fixtures/adversarial')
const evidencePath = resolve(repositoryRoot, 'spec/.history/v2/evidence/ttsc-qualification.json')
const installation = argument('--installation')
const nativeOutput = argument('--native-output')
const writeEvidence = process.argv.includes('--write')
const productionNativeCapabilities = [
  'typescript.project',
  'typescript.diagnostic',
  'typescript.source',
  'typescript.symbol',
  'typescript.occurrence',
  'typescript.body',
  'astrale.typescript.module',
] as const
const productionNativeModules = [
  {
    id: 'fixture.sdk',
    name: 'FixtureSdk',
    project: 'tsconfig.json',
    root: 'src/sdk',
    entrypoint: 'src/sdk/index.ts',
    facades: [],
    aliases: [],
    internals: [],
  },
] as const

if (!installation) {
  throw new Error(
    'Usage: qualify.ts --installation <isolated ttsc project> [--native-output <path>] [--write]',
  )
}
if (writeEvidence && !nativeOutput) {
  throw new Error('Governed ttsc evidence requires --native-output so the exact qualified binary is retained.')
}

async function main(): Promise<void> {
  const toolchain = JSON.parse(await readFile(resolve(qualificationRoot, 'toolchain.json'), 'utf8'))
  const graphPackage = JSON.parse(
    await readFile(resolve(installation, 'node_modules/@ttsc/graph/package.json'), 'utf8'),
  )
  const ttscPackage = JSON.parse(
    await readFile(resolve(installation, 'node_modules/ttsc/package.json'), 'utf8'),
  )
  assert.equal(graphPackage.version, toolchain.graph.version)
  assert.equal(ttscPackage.version, toolchain.ttsc.version)

  const graphModule = (await import(
    pathToFileURL(resolve(installation, 'node_modules/@ttsc/graph/lib/index.js')).href
  )) as {
    readonly loadGraph: (options: GraphOptions) => GraphMemory
    readonly resolveGraphBinary: (env: NodeJS.ProcessEnv, cwd: string) => string | null
    readonly TtscGraphSession: new (options: GraphOptions) => GraphSession
  }
  const binary = graphModule.resolveGraphBinary(process.env, installation)
  assert(binary, 'The exact ttsc platform graph binary must be installed.')
  assert.equal(sha256(await readFile(binary)), toolchain.darwinArm64.ttscgraphSha256)

  const temporary = await mkdtemp(join(tmpdir(), 'astrale-typespec-v2-ttsc-'))
  const project = join(temporary, 'project')
  await cp(fixtureSource, project, { recursive: true })
  await cp(
    resolve(repositoryRoot, 'spec/analysis/typescript/native'),
    join(project, 'native-analysis'),
    {
      recursive: true,
    },
  )

  const checks: Record<string, unknown> = {}
  let completed = false
  try {
    const graph = graphModule.loadGraph({ cwd: project, tsconfig: 'tsconfig.json', binary })
    const sdkBuilder = uniqueNode(graph, 'defineMutation', 'src/sdk/builder.ts')
    const fakeBuilder = uniqueNode(graph, 'defineMutation', 'src/fake.ts')
    const aliasCase = uniqueNode(graph, 'aliasCase', 'src/cases.ts')
    const collisionCase = uniqueNode(graph, 'collisionCase', 'src/cases.ts')
    const duplicateCase = uniqueNode(graph, 'duplicateCase', 'src/cases.ts')

    assertCall(graph, aliasCase.id, sdkBuilder.id)
    assertCall(graph, collisionCase.id, fakeBuilder.id)
    assert.equal(callEdges(graph, collisionCase.id, sdkBuilder.id).length, 0)
    assert.equal(callEdges(graph, duplicateCase.id, sdkBuilder.id).length, 1)
    assert(
      graph.nodes.some(
        (node) =>
          node.name === 'innerCallback' && node.file.endsWith('src/cases.ts') && node.closure,
      ),
      'A function-local callback must be represented as a closure node.',
    )
    assert(graph.nodes.some((node) => node.name === 'referencedBuilder'))
    checks.semanticGraph = {
      aliasesAndBarrels: 'canonical declaration in src/sdk/builder.ts',
      spellingCollision: 'separate src/fake.ts target',
      closureCallback: true,
      projectReference: true,
      callMultiplicity: {
        observedOccurrences: 2,
        graphEdges: 1,
        disposition: 'requires occurrence facts outside @ttsc/graph',
      },
    }

    const testGraph = graphModule.loadGraph({
      cwd: project,
      tsconfig: 'tsconfig.test.json',
      binary,
    })
    assert(!graph.nodes.some((node) => node.name === 'testCase'))
    assert(testGraph.nodes.some((node) => node.name === 'testCase'))
    checks.projectUniverses = {
      productionHasTestCase: false,
      testHasTestCase: true,
    }

    const publicSession = new graphModule.TtscGraphSession({
      cwd: project,
      tsconfig: 'tsconfig.json',
      binary,
    })
    const firstMemory = await publicSession.graph()
    const reusedMemory = await publicSession.graph()
    assert.equal(firstMemory, reusedMemory)
    publicSession.close()

    const cancelledSession = new graphModule.TtscGraphSession({
      cwd: project,
      tsconfig: 'tsconfig.json',
      binary,
    })
    const controller = new AbortController()
    controller.abort(new Error('qualification cancellation'))
    await assert.rejects(cancelledSession.graph({ signal: controller.signal }))
    cancelledSession.close()
    checks.lifecycle = { unchangedMemoryReused: true, cancellation: true, idempotentClose: true }

    const typescriptPackage = JSON.parse(
      await readFile(resolve(installation, 'node_modules/typescript/package.json'), 'utf8'),
    )
    assert.equal(typescriptPackage.version, toolchain.typescriptGo.typescript)
    const typescriptRoot = dirname(
      await realpath(resolve(installation, 'node_modules/typescript/package.json')),
    )
    const tsgoBinary = resolve(
      typescriptRoot,
      '..',
      '@typescript',
      `typescript-${process.platform}-${process.arch}`,
      'lib',
      process.platform === 'win32' ? 'tsc.exe' : 'tsc',
    )
    const ttscLauncher = resolve(installation, 'node_modules/ttsc/lib/launcher/ttsc.js')
    const pluginCache = join(temporary, 'ttsc-native-cache')
    const bodyEnvironment = {
      ...process.env,
      GOTOOLCHAIN: 'local',
      PATH: '/usr/bin:/bin',
      TTSC_CACHE_DIR: pluginCache,
      TTSC_TSGO_BINARY: tsgoBinary,
    }
    const localGo = await runNative('/usr/bin/which', ['go'], bodyEnvironment)
    assert.notEqual(localGo.code, 0, 'The no-local-Go qualification PATH unexpectedly contains Go.')
    const bodyColdStarted = performance.now()
    const bodyCold = await runNative(
      process.execPath,
      [ttscLauncher, '-p', 'tsconfig.body.json'],
      bodyEnvironment,
      project,
    )
    const bodyColdMs = performance.now() - bodyColdStarted
    assert.equal(bodyCold.code, 0, bodyCold.stderr)
    assert.match(bodyCold.stderr, /building source plugin/u)
    const bodyArtifactPath = join(project, '.ttsc-body-facts.json')
    const bodyBytes = await readFile(bodyArtifactPath)
    const bodyFacts = JSON.parse(bodyBytes.toString('utf8')) as BodyArtifact
    assertBodyFacts(bodyFacts, await readFile(join(project, 'src/cases.ts')))

    await rm(bodyArtifactPath)
    const bodyWarmStarted = performance.now()
    const bodyWarm = await runNative(
      process.execPath,
      [ttscLauncher, '-p', 'tsconfig.body.json'],
      bodyEnvironment,
      project,
    )
    const bodyWarmMs = performance.now() - bodyWarmStarted
    assert.equal(bodyWarm.code, 0, bodyWarm.stderr)
    assert.doesNotMatch(bodyWarm.stderr, /building source plugin/u)
    const warmBodyBytes = await readFile(bodyArtifactPath)
    assert.deepEqual(warmBodyBytes, bodyBytes)
    checks.compilerNearBody = {
      api: 'ttsc driver.LoadProgram + TypeScript-Go AST/Checker',
      artifactFormat: bodyFacts.format,
      artifactVersion: bodyFacts.version,
      capabilities: bodyFacts.capabilities,
      sourceFiles: bodyFacts.sources.length,
      callOccurrences: bodyFacts.calls.length,
      sdkCallOccurrences: sdkBodyCalls(bodyFacts).length,
      valueStates: [
        ...new Set(
          sdkBodyCalls(bodyFacts)
            .map((call) => call.nameValue?.state)
            .filter(Boolean),
        ),
      ].sort(),
      callbackForms: [
        ...new Set(
          sdkBodyCalls(bodyFacts)
            .map((call) => call.callback?.form)
            .filter(Boolean),
        ),
      ].sort(),
      deterministicDigest: sha256(bodyBytes),
    }
    checks.sourcePluginPackaging = {
      compiledWithoutLocalGo: true,
      coldCacheBuildMs: Math.round(bodyColdMs),
      warmCacheRunMs: Math.round(bodyWarmMs),
      warmCacheReused: true,
      typescriptGoBinary: `${process.platform}-${process.arch}`,
    }

    const nativeColdStarted = performance.now()
    const nativeCold = await runNative(
      process.execPath,
      [ttscLauncher, '-p', 'tsconfig.native-analysis.json'],
      bodyEnvironment,
      project,
    )
    const nativeColdMs = performance.now() - nativeColdStarted
    assert.equal(nativeCold.code, 0, nativeCold.stderr)
    assert.match(nativeCold.stderr, /building source plugin/u)
    const nativeWarmStarted = performance.now()
    const nativeWarm = await runNative(
      process.execPath,
      [ttscLauncher, '-p', 'tsconfig.native-analysis.json'],
      bodyEnvironment,
      project,
    )
    const nativeWarmMs = performance.now() - nativeWarmStarted
    assert.equal(nativeWarm.code, 0, nativeWarm.stderr)
    assert.doesNotMatch(nativeWarm.stderr, /building source plugin/u)
    checks.productionNativePackaging = {
      compiledWithoutLocalGo: true,
      coldCacheBuildMs: Math.round(nativeColdMs),
      warmCacheRunMs: Math.round(nativeWarmMs),
      warmCacheReused: true,
      protocolVersion: 1,
    }

    const nativeBinary = await findPluginBinary(pluginCache, 'astrale-typespec-v2-analysis')
    checks.productionNativePackaging = {
      ...checks.productionNativePackaging,
      binarySha256: sha256(await readFile(nativeBinary)),
    }
    const sessions = createProcessNativeAnalysisSessionFactory({ command: nativeBinary })
    const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 8 })
    const service = await createTypeScriptAnalysisService({
      project: {
        root: project,
        config: 'tsconfig.json',
        capabilities: productionNativeCapabilities,
        modules: productionNativeModules,
      },
      sessions,
      store,
    })
    const casesPathForNative = join(project, 'src/cases.ts')
    const casesBeforeNative = await readFile(casesPathForNative, 'utf8')
    const builderPathForNative = join(project, 'src/sdk/builder.ts')
    const builderBeforeNative = await readFile(builderPathForNative, 'utf8')
    const nativeCreatedPath = join(project, 'src/native-created.ts')
    const nativeRenamedPath = join(project, 'src/native-renamed.ts')
    const nativeConfigPath = join(project, 'tsconfig.json')
    const nativeConfigBefore = await readFile(nativeConfigPath, 'utf8')
    try {
      const initial = await service.refresh()
      assert(initial.transaction)
      assert.equal(initial.transaction.upserts.length, initial.transaction.manifest.length)
      const initialUniverse = initial.generation.universe
      assert.equal(service.universe, initialUniverse)
      const nativeSummary = await inspectProductionNative(store, initialUniverse, project)
      const publicIdentities = await modulePublicIdentities(store, initialUniverse, 'fixture.sdk')
      await writeFile(
        builderPathForNative,
        `// unrelated prefix must not become semantic identity\n${builderBeforeNative}`,
        'utf8',
      )
      const positionShifted = await service.refresh({ changed: ['src/sdk/builder.ts'] })
      assert(positionShifted.transaction)
      assert.deepEqual(
        await modulePublicIdentities(store, positionShifted.generation.universe, 'fixture.sdk'),
        publicIdentities,
        'Inserting unrelated text before public declarations must not rename their semantic identities.',
      )
      await writeFile(builderPathForNative, builderBeforeNative, 'utf8')
      const positionRestored = await service.refresh({ changed: ['src/sdk/builder.ts'] })
      assert(positionRestored.transaction)
      assert.equal(positionRestored.generation.id, initial.generation.id)
      const unchanged = await service.refresh()
      assert.equal(unchanged.transaction, undefined)
      assert.equal(unchanged.generation.id, initial.generation.id)

      await writeFile(
        casesPathForNative,
        casesBeforeNative.replace("name: 'known'", "name: 'known-native-edited'"),
        'utf8',
      )
      const incremental = await service.refresh({ changed: ['src/cases.ts'] })
      assert(incremental.transaction)
      assert(incremental.transaction.upserts.length > 0)
      assert(incremental.transaction.upserts.length < incremental.transaction.manifest.length)

      const coldStore = createMemoryAnalysisStore()
      const coldService = await createTypeScriptAnalysisService({
        project: {
          root: project,
          config: 'tsconfig.json',
          capabilities: productionNativeCapabilities,
          modules: productionNativeModules,
        },
        sessions,
        store: coldStore,
      })
      try {
        const cold = await coldService.refresh()
        assert.equal(cold.generation.id, incremental.generation.id)
        assert.equal(cold.generation.universe, incremental.generation.universe)
        assert.deepEqual(
          await exportFacts(coldStore, cold.generation.universe),
          await exportFacts(store, incremental.generation.universe),
        )
      } finally {
        await coldService.dispose()
        await coldStore.dispose()
      }

      await writeFile(nativeCreatedPath, 'export const nativeCreated = true\n', 'utf8')
      const beforeCreateUniverse = incremental.generation.universe
      const created = await service.refresh({ changed: ['src/native-created.ts'] })
      assert(created.transaction)
      assert.notEqual(created.generation.universe, beforeCreateUniverse)
      assert.equal(created.transaction.upserts.length, created.transaction.manifest.length)
      await assertProductionColdEquivalent(nativeBinary, project, created.generation.universe, store)

      await rename(nativeCreatedPath, nativeRenamedPath)
      const beforeRenameUniverse = created.generation.universe
      const renamed = await service.refresh({
        changed: ['src/native-created.ts', 'src/native-renamed.ts'],
      })
      assert(renamed.transaction)
      assert.notEqual(renamed.generation.universe, beforeRenameUniverse)
      assert.equal(renamed.transaction.upserts.length, renamed.transaction.manifest.length)
      await assertProductionColdEquivalent(nativeBinary, project, renamed.generation.universe, store)

      await rm(nativeRenamedPath)
      const deleted = await service.refresh({ changed: ['src/native-renamed.ts'] })
      assert.equal(deleted.generation.universe, incremental.generation.universe)
      assert.equal(deleted.generation.id, incremental.generation.id)
      assert.equal(deleted.transaction, undefined)
      await assertProductionColdEquivalent(nativeBinary, project, deleted.generation.universe, store)

      await writeFile(nativeConfigPath, `${nativeConfigBefore.trimEnd()}\n\n`, 'utf8')
      const beforeConfigUniverse = deleted.generation.universe
      const configured = await service.refresh({ changed: ['tsconfig.json'] })
      assert(configured.transaction)
      assert.notEqual(configured.generation.universe, beforeConfigUniverse)
      assert.equal(configured.transaction.upserts.length, configured.transaction.manifest.length)
      await assertProductionColdEquivalent(nativeBinary, project, configured.generation.universe, store)
      await writeFile(nativeConfigPath, nativeConfigBefore, 'utf8')
      const configRestored = await service.refresh({ changed: ['tsconfig.json'] })
      assert.equal(configRestored.generation.universe, incremental.generation.universe)
      assert.equal(configRestored.generation.id, incremental.generation.id)
      assert.equal(configRestored.transaction, undefined)
      await assertProductionColdEquivalent(nativeBinary, project, configRestored.generation.universe, store)

      checks.productionNativeProtocol = {
        generationValidatedByStore: true,
        unchangedStable: true,
        incrementalUpserts: incremental.transaction.upserts.length,
        manifestShards: incremental.transaction.manifest.length,
        coldEquivalent: true,
        publicIdentityPositionIndependent: true,
        topologyChanges: {
          create: transactionSize(created.transaction),
          rename: transactionSize(renamed.transaction),
          delete: { reusedPortableUniverse: true },
          config: transactionSize(configured.transaction),
          contentAddressedConfigRestore: configRestored.generation.id === incremental.generation.id,
        },
        universeIdentity: {
          callerSeedRemoved: true,
          rootMembershipRollover: true,
          configurationRollover: true,
          restoredUniverseReused: true,
        },
        ...nativeSummary,
      }
    } finally {
      await rm(nativeCreatedPath, { force: true })
      await rm(nativeRenamedPath, { force: true })
      await writeFile(nativeConfigPath, nativeConfigBefore, 'utf8')
      await writeFile(casesPathForNative, casesBeforeNative, 'utf8')
      await writeFile(builderPathForNative, builderBeforeNative, 'utf8')
      await service.dispose()
      await store.dispose()
    }

    const protocol = new NativeProtocol(binary, project, 'tsconfig.json')
    try {
      const initial = await protocol.request(1)
      assert.equal(initial.protocolVersion, toolchain.graph.serveProtocol)
      assert.equal(initial.mode, 'initial')
      assert.equal(initial.changed, true)
      assert(initial.snapshot)
      assert.equal(initial.snapshot.protocolVersion, toolchain.graph.snapshotProtocol)
      assert.equal(initial.snapshot.schemaVersion, toolchain.graph.dumpSchema)
      assert.deepEqual(
        [...initial.capabilities].sort(),
        ['diagnostics', 'diskDigests', 'sourceDigests', 'universe'].sort(),
      )
      const materialized = new Map<string, ShardState>()
      applyTransaction(materialized, initial.snapshot)
      await assertColdEquivalent(binary, project, 'tsconfig.json', materialized)

      const unchanged = await protocol.request(2)
      assert.equal(unchanged.mode, 'unchanged')
      assert.equal(unchanged.changed, false)
      assert.equal(unchanged.snapshot, undefined)

      const casesPath = join(project, 'src/cases.ts')
      const cases = await readFile(casesPath, 'utf8')
      await writeFile(casesPath, cases.replace("name: 'known'", "name: 'known-edited'"), 'utf8')
      const bodyEdit = await protocol.request(3)
      assert(bodyEdit.snapshot)
      assert(['incremental', 'rebuild'].includes(bodyEdit.mode))
      assert.equal(bodyEdit.snapshot.baseGeneration, initial.snapshot.generation)
      const retainedAfterBodyEdit = retainedShards(initial.snapshot, bodyEdit.snapshot)
      assert(retainedAfterBodyEdit > 0)
      assert(bodyEdit.snapshot.upserts.length < bodyEdit.snapshot.manifest.length)
      applyTransaction(materialized, bodyEdit.snapshot)
      await assertColdEquivalent(binary, project, 'tsconfig.json', materialized)

      const createdPath = join(project, 'src/created.ts')
      await writeFile(createdPath, 'export const created = 1\n', 'utf8')
      const created = await protocol.request(4)
      assert.equal(created.mode, 'reload')
      assert(created.snapshot)
      applyTransaction(materialized, created.snapshot)
      await assertColdEquivalent(binary, project, 'tsconfig.json', materialized)

      const renamedPath = join(project, 'src/renamed.ts')
      await rename(createdPath, renamedPath)
      const renamed = await protocol.request(5)
      assert.equal(renamed.mode, 'reload')
      assert(renamed.snapshot)
      applyTransaction(materialized, renamed.snapshot)
      await assertColdEquivalent(binary, project, 'tsconfig.json', materialized)

      await rm(renamedPath)
      const deleted = await protocol.request(6)
      assert.equal(deleted.mode, 'reload')
      assert(deleted.snapshot)
      applyTransaction(materialized, deleted.snapshot)
      await assertColdEquivalent(binary, project, 'tsconfig.json', materialized)

      const configPath = join(project, 'tsconfig.json')
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      config.compilerOptions.noUnusedLocals = true
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      const configEdit = await protocol.request(7)
      assert.equal(configEdit.mode, 'reload')
      assert(configEdit.snapshot)
      applyTransaction(materialized, configEdit.snapshot)
      await assertColdEquivalent(binary, project, 'tsconfig.json', materialized)

      checks.incremental = {
        initial: initial.mode,
        unchanged: unchanged.mode,
        bodyEdit: bodyEdit.mode,
        bodyEditRetainedShards: retainedAfterBodyEdit,
        bodyEditUpserts: bodyEdit.snapshot.upserts.length,
        bodyEditManifest: bodyEdit.snapshot.manifest.length,
        create: created.mode,
        rename: renamed.mode,
        delete: deleted.mode,
        config: configEdit.mode,
        coldDifferentialChecks: 6,
      }
    } finally {
      await protocol.close()
    }

    const noGo = await runNative(
      binary,
      ['dump', '--cwd', project, '--tsconfig', 'tsconfig.json'],
      {
        ...process.env,
        PATH: '/usr/bin:/bin',
      },
    )
    assert.equal(noGo.code, 0, noGo.stderr)
    JSON.parse(noGo.stdout)
    checks.packaging = {
      graphWithoutLocalGo: true,
      binarySha256: sha256(await readFile(binary)),
      platform: `${process.platform}-${process.arch}`,
    }

    if (nativeOutput) {
      const output = resolve(nativeOutput)
      await mkdir(dirname(output), { recursive: true })
      await copyFile(nativeBinary, output)
      await chmod(output, 0o755)
    }

    const result = {
      format: 'astrale.typespec.v2.ttsc-qualification',
      version: 1,
      status: 'qualified',
      toolchain,
      checks,
      boundary: {
        graph:
          'symbol-level topology; repeated call occurrences intentionally collapse to one edge',
        bodyFacts:
          'portable occurrence relations, symbols, structured CFG, resolved calls, bounded values, and conservative def-use',
        deferred:
          'conditional-expression CFG expansion and analyses beyond the ratified bounded portable evaluator',
      },
    }
    const serialized = `${JSON.stringify(result, null, 2)}\n`
    if (writeEvidence) await writeFile(evidencePath, serialized, 'utf8')
    else process.stdout.write(serialized)
    completed = true
  } finally {
    if (completed) await rm(temporary, { recursive: true, force: true })
    else process.stderr.write(`Preserved failed ttsc qualification fixture at ${temporary}.\n`)
  }
}

interface GraphOptions {
  readonly cwd: string
  readonly tsconfig: string
  readonly binary: string
}

interface GraphNode {
  readonly id: string
  readonly name: string
  readonly file: string
  readonly closure?: boolean
}

interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: string
}

interface GraphMemory {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

interface GraphSession {
  graph(options?: { readonly signal?: AbortSignal }): Promise<GraphMemory>
  close(): void
}

interface BodyTarget {
  readonly symbol: string
  readonly origin: 'workspace' | 'external'
  readonly span: { readonly file: string; readonly start: number; readonly end: number }
}

interface BodyValue {
  readonly state: 'known' | 'unknown' | 'ambiguous' | 'unsupported'
  readonly values?: readonly string[]
  readonly reason?: string
}

interface BodyCall {
  readonly id: string
  readonly span: { readonly file: string; readonly start: number; readonly end: number }
  readonly callee: string
  readonly target?: BodyTarget
  readonly arguments: readonly {
    readonly index: number
    readonly kind: number
    readonly text: string
  }[]
  readonly nameValue?: BodyValue
  readonly callback?: {
    readonly form: 'reference' | 'returned' | 'inline' | 'unsupported'
    readonly target?: BodyTarget
    readonly body?: { readonly file: string; readonly start: number; readonly end: number }
    readonly resolvedTarget?: BodyTarget
    readonly resolvedBody?: { readonly file: string; readonly start: number; readonly end: number }
  }
  readonly forwardedTarget?: BodyTarget
  readonly forwardedValue?: BodyValue
}

interface BodyArtifact {
  readonly format: string
  readonly version: number
  readonly capabilities: readonly string[]
  readonly sources: readonly { readonly file: string; readonly sha256: string }[]
  readonly calls: readonly BodyCall[]
}

interface NativeResponse {
  readonly id: number
  readonly protocolVersion: number
  readonly mode: string
  readonly capabilities: readonly string[]
  readonly changed: boolean
  readonly snapshot?: Transaction
  readonly error?: string
}

interface Transaction {
  readonly protocolVersion: number
  readonly schemaVersion: number
  readonly sequence: number
  readonly generation: string
  readonly baseGeneration?: string
  readonly upserts: readonly { readonly digest: string; readonly shard: Shard }[]
  readonly deletes: readonly string[]
  readonly manifest: readonly { readonly key: string; readonly digest: string }[]
}

interface Shard {
  readonly key: string
  readonly nodes: readonly Record<string, unknown>[]
  readonly edges: readonly Record<string, unknown>[]
  readonly diagnostics: readonly Record<string, unknown>[]
}

interface ShardState {
  readonly digest: string
  readonly shard: Shard
}

class NativeProtocol {
  readonly #child
  readonly #pending = new Map<
    number,
    { resolve(value: NativeResponse): void; reject(error: Error): void }
  >()
  #stderr = ''

  constructor(binary: string, cwd: string, tsconfig: string) {
    this.#child = spawn(binary, ['serve', '--cwd', cwd, '--tsconfig', tsconfig], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', (chunk) => (this.#stderr += chunk))
    const lines = createInterface({ input: this.#child.stdout })
    lines.on('line', (line) => {
      const response = JSON.parse(line) as NativeResponse
      const pending = this.#pending.get(response.id)
      if (!pending) return
      this.#pending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error))
      else pending.resolve(response)
    })
    this.#child.once('error', (error) => this.#fail(error))
    this.#child.once('exit', (code, signal) => {
      if (this.#pending.size) {
        this.#fail(
          new Error(
            `ttscgraph serve exited code=${String(code)} signal=${String(signal)}: ${this.#stderr}`,
          ),
        )
      }
    })
  }

  request(id: number): Promise<NativeResponse> {
    return new Promise((resolveRequest, rejectRequest) => {
      this.#pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      this.#child.stdin.write(`${JSON.stringify({ id, graphSnapshotVersion: 1 })}\n`)
    })
  }

  async close(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    const exited = new Promise<void>((resolveExit) => this.#child.once('exit', () => resolveExit()))
    this.#child.kill('SIGTERM')
    await exited
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

function uniqueNode(graph: GraphMemory, name: string, suffix: string): GraphNode {
  const nodes = graph.nodes.filter((node) => node.name === name && node.file.endsWith(suffix))
  assert.equal(nodes.length, 1, `Expected one ${name} node in ${suffix}, found ${nodes.length}.`)
  return nodes[0]!
}

function callEdges(graph: GraphMemory, from: string, to: string): readonly GraphEdge[] {
  return graph.edges.filter((edge) => edge.kind === 'calls' && edge.from === from && edge.to === to)
}

function assertCall(graph: GraphMemory, from: string, to: string): void {
  assert.equal(
    callEdges(graph, from, to).length,
    1,
    `Missing canonical call edge ${from} -> ${to}.`,
  )
}

function sdkBodyCalls(artifact: BodyArtifact): readonly BodyCall[] {
  return artifact.calls.filter(
    (call) =>
      call.target?.symbol === 'defineMutation' && call.target.span.file === 'src/sdk/builder.ts',
  )
}

function assertBodyFacts(artifact: BodyArtifact, casesSource: Uint8Array): void {
  assert.equal(artifact.format, 'astrale.typespec.v2.body-facts')
  assert.equal(artifact.version, 1)
  assert.deepEqual(
    [...artifact.capabilities].sort(),
    [
      'argument-source',
      'bounded-value-state',
      'callback-body',
      'one-hop-parameter-binding',
      'occurrence-calls',
      'resolved-symbol-target',
      'source-digest',
    ].sort(),
  )
  assert.equal(new Set(artifact.calls.map((call) => call.id)).size, artifact.calls.length)
  const cases = artifact.sources.filter((source) => source.file === 'src/cases.ts')
  assert.equal(cases.length, 1)
  assert.equal(cases[0]!.sha256, sha256(casesSource))
  assert(!artifact.sources.some((source) => source.file.startsWith('tests/')))

  const sdkCalls = sdkBodyCalls(artifact)
  assert.equal(sdkCalls.length, 9)
  assert.equal(
    sdkCalls.filter((call) => ['first', 'second'].includes(call.nameValue?.values?.[0] ?? ''))
      .length,
    2,
    'Repeated calls must remain two occurrence facts even though the graph has one edge.',
  )
  assert.deepEqual([...new Set(sdkCalls.map((call) => call.nameValue?.state))].sort(), [
    'ambiguous',
    'known',
    'unknown',
    'unsupported',
  ])
  const ambiguous = sdkCalls.find((call) => call.nameValue?.state === 'ambiguous')
  assert.deepEqual(ambiguous?.nameValue?.values, ['left', 'right'])
  assert(
    sdkCalls.some(
      (call) => call.nameValue?.state === 'unknown' && call.nameValue.reason === 'runtime-symbol',
    ),
  )
  assert(
    sdkCalls.some(
      (call) =>
        call.nameValue?.state === 'unsupported' &&
        call.nameValue.reason === 'call-expression:String',
    ),
  )

  const collision = artifact.calls.find((call) => call.callee === 'spellingCollision')
  assert.equal(collision?.target?.span.file, 'src/fake.ts')
  const stored = sdkCalls.find((call) => call.nameValue?.values?.[0] === 'known')
  assert.equal(stored?.callback?.target?.symbol, 'storedCallback')
  assert.equal(stored?.callback?.body?.file, 'src/cases.ts')
  const returned = sdkCalls.find((call) => call.nameValue?.values?.[0] === 'returned')
  assert.equal(returned?.callback?.form, 'returned')
  assert.equal(returned?.callback?.target?.symbol, 'callbackFactory')
  assert.equal(returned?.callback?.resolvedTarget?.symbol, 'storedCallback')
  assert.equal(returned?.callback?.resolvedBody?.file, 'src/cases.ts')
  const closure = sdkCalls.find((call) => call.nameValue?.values?.[0] === 'closure')
  assert.equal(closure?.callback?.target?.symbol, 'innerCallback')
  assert.equal(closure?.callback?.body?.file, 'src/cases.ts')

  const forward = artifact.calls.find((call) => call.target?.symbol === 'forward')
  assert.equal(forward?.forwardedTarget?.span.file, 'src/sdk/builder.ts')
  assert.deepEqual(forward?.forwardedValue, { state: 'known', values: ['forwarded'] })
  assert(
    artifact.calls
      .filter((call) => call.target?.origin === 'external')
      .every((call) => call.target?.span.file.startsWith('external:')),
  )
}

function applyTransaction(store: Map<string, ShardState>, transaction: Transaction): void {
  for (const key of transaction.deletes) store.delete(key)
  for (const upsert of transaction.upserts) {
    assert.equal(upsert.digest, wireDigest(upsert.shard))
    store.set(upsert.shard.key, upsert)
  }
  assert.deepEqual(
    [...store].map(([key, value]) => ({ key, digest: value.digest })).sort(byKey),
    [...transaction.manifest].sort(byKey),
  )
}

function retainedShards(before: Transaction, after: Transaction): number {
  const previous = new Map(before.manifest.map((entry) => [entry.key, entry.digest]))
  return after.manifest.filter((entry) => previous.get(entry.key) === entry.digest).length
}

async function assertColdEquivalent(
  binary: string,
  cwd: string,
  tsconfig: string,
  store: ReadonlyMap<string, ShardState>,
): Promise<void> {
  const cold = await runNative(binary, ['dump', '--cwd', cwd, '--tsconfig', tsconfig], process.env)
  assert.equal(cold.code, 0, cold.stderr)
  const dump = JSON.parse(cold.stdout) as {
    readonly nodes: readonly Record<string, unknown>[]
    readonly edges: readonly Record<string, unknown>[]
    readonly diagnostics: readonly Record<string, unknown>[]
  }
  const materialized = [...store.values()].flatMap((value) => [value.shard])
  assert.deepEqual(
    facts({
      nodes: materialized.flatMap((shard) => shard.nodes),
      edges: materialized.flatMap((shard) => shard.edges),
      diagnostics: materialized.flatMap((shard) => shard.diagnostics),
    }),
    facts(dump),
  )
}

function facts(value: {
  readonly nodes: readonly Record<string, unknown>[]
  readonly edges: readonly Record<string, unknown>[]
  readonly diagnostics: readonly Record<string, unknown>[]
}): unknown {
  return {
    nodes: [...value.nodes].sort((left, right) => String(left.id).localeCompare(String(right.id))),
    edges: [...value.edges].sort((left, right) =>
      `${String(left.from)}\0${String(left.to)}\0${String(left.kind)}`.localeCompare(
        `${String(right.from)}\0${String(right.to)}\0${String(right.kind)}`,
      ),
    ),
    diagnostics: [...value.diagnostics].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
  }
}

async function findPluginBinary(cache: string, versionMarker: string): Promise<string> {
  const directory = resolve(cache, 'plugins')
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Source-plugin protocol-v2 lock directories intentionally coexist with
    // committed cache entries. They never contain an executable and may hold
    // retired generations while another process owns the build lock.
    if (!entry.isDirectory() || entry.name.includes('.lock.')) continue
    const candidate = resolve(
      directory,
      entry.name,
      process.platform === 'win32' ? 'plugin.exe' : 'plugin',
    )
    const version = await runNative(candidate, ['version'], process.env).catch(() => undefined)
    if (!version) continue
    if (version.code === 0 && version.stdout.includes(versionMarker)) return candidate
  }
  throw new Error(`Unable to locate ${versionMarker} in ${directory}.`)
}

async function inspectProductionNative(
  store: AnalysisStore,
  universe: ProjectUniverseId,
  root: string,
): Promise<Record<string, unknown>> {
  const query = await store.open(universe)
  try {
    const all = await query.facts({}, { limit: 10_000 })
    const sourcePaths = new Map(
      all.facts
        .filter((fact) => fact.namespace === 'typescript.source')
        .map((fact) => {
          const payload = fact.payload as { readonly source: string; readonly logicalPath: string }
          return [payload.source, payload.logicalPath] as const
        }),
    )
    const sdkSymbols = all.facts
      .filter((fact) => fact.namespace === 'typescript.symbol')
      .filter((fact) => {
        const payload = fact.payload as {
          readonly name: string
          readonly declarations: readonly { readonly source: string }[]
        }
        return (
          payload.name === 'defineMutation' &&
          payload.declarations.some(
            (declaration) => sourcePaths.get(declaration.source) === 'src/sdk/builder.ts',
          )
        )
      })
      .map((fact) => fact.subject)
    assert.equal(sdkSymbols.length, 1)

    const bodies = all.facts.filter((fact) => fact.namespace === 'typescript.body')
    const modules = all.facts.filter(
      (fact) => fact.namespace === 'astrale.typescript.module' && fact.subject === 'fixture.sdk',
    )
    assert.equal(modules.length, 1)
    const moduleFact = modules[0]!
    const modulePayload = moduleFact.payload as {
      readonly exports: readonly {
        readonly name: string
        readonly declaration: string
        readonly sourceModule?: string
      }[]
      readonly declarations: readonly ObservedDeclaration[]
      readonly dependencies: readonly TypeScriptDependencyFact[]
      readonly inboundDependencies: readonly TypeScriptDependencyFact[]
      readonly declaredPackages: readonly string[]
      readonly developmentPackages: readonly string[]
      readonly workspacePackages: readonly string[]
      readonly errorCodes: readonly unknown[]
      readonly files: readonly string[]
      readonly issues: readonly { readonly code: string }[]
    }
    assert.equal(moduleFact.completeness.kind, 'complete')
    assert.deepEqual(
      modulePayload.exports.map((entry) => entry.name),
      [
        'brandedResult',
        'conditionalKind',
        'defineMutation',
        'frozenSurface',
        'identityPayload',
        'indexedResult',
        'optionalMode',
        'PublicBox',
        'MergedSurface',
        'Kind',
        'AuthenticationMode',
        'BroadString',
        'BrandedText',
        'GenericBrand',
        'GenericConditional',
        'GenericHandler',
        'GenericLookup',
        'GenericOutcome',
        'InstantiatedLazy',
        'Json',
        'LargeCounter',
        'MutationOptions',
        'MutationPayload',
        'RecursiveArray',
        'RecursiveObject',
        'RecursiveValue',
        'SurfaceChoice',
        'SurfaceOptions',
        'StringMap',
        'TupleHolder',
        'PublicReferencedType',
      ],
    )
    assert.equal(
      modulePayload.exports.find((entry) => entry.name === 'PublicReferencedType')?.sourceModule,
      'package:@fixture/referenced',
      'External re-export provenance must survive the canonical declaration alias.',
    )
    const options = modulePayload.declarations.find((entry) => entry.name === 'MutationOptions')
    assert.equal(options?.kind, 'interface')
    assert.deepEqual(
      options?.properties?.map((property) => property.name),
      ['marker', 'name', 'run'],
    )
    assert.equal(
      options?.properties?.find((property) => property.name === 'name')?.type?.kind,
      'primitive',
    )
    assert.equal(
      options?.properties?.find((property) => property.name === 'marker')?.type?.kind,
      'null',
    )
    const builder = modulePayload.declarations.find((entry) => entry.name === 'defineMutation')
    assert.equal(builder?.kind, 'callable')
    assert.equal(builder?.callable?.parameters[0]?.name, 'options')
    assert.equal(builder?.callable?.parameters[0]?.type.kind, 'parameter')
    const surface = modulePayload.declarations.find((entry) => entry.name === 'SurfaceOptions')
    assert.equal(surface?.kind, 'interface')
    const surfaceProperties = new Map(
      surface?.properties?.map((property) => [property.name, property]),
    )
    assert.deepEqual(surfaceProperties.get('auth')?.type, {
      kind: 'reference',
      identity: modulePayload.declarations.find((entry) => entry.name === 'AuthenticationMode')
        ?.identity,
      name: 'AuthenticationMode',
      arguments: [],
    })
    assert.deepEqual(surfaceProperties.get('opaque')?.type, { kind: 'primitive', name: 'object' })
    assert.deepEqual(surfaceProperties.get('count')?.type, { kind: 'primitive', name: 'bigint' })
    assert.deepEqual(surfaceProperties.get('token')?.type, { kind: 'primitive', name: 'symbol' })
    assert.deepEqual(surfaceProperties.get('forbidden')?.type, { kind: 'undefined' })
    assert.equal(surfaceProperties.get('referenced')?.type.kind, 'reference')
    assert.equal(
      surfaceProperties.get('referenced')?.type.kind === 'reference'
        ? surfaceProperties.get('referenced')?.type.name
        : undefined,
      'ReferencedType',
    )
    assert.deepEqual(surfaceProperties.get('createdAt')?.type, {
      kind: 'reference',
      identity: 'platform:typescript#Date',
      name: 'Date',
      arguments: [],
    })
    assert.equal(
      modulePayload.declarations.find((entry) => entry.name === 'Date')?.identity,
      'platform:typescript#Date',
    )
    assert.deepEqual(
      modulePayload.declarations.find((entry) => entry.name === 'LargeCounter')?.valueType,
      { kind: 'bigint-literal', value: '9007199254740993' },
    )
    const genericBrand = modulePayload.declarations.find((entry) => entry.name === 'GenericBrand')
    const genericBrandType = JSON.stringify(genericBrand?.authoredValueType)
    assert(
      genericBrandType.includes('"kind":"parameter"'),
      'Authored generic aliases must retain nested standard-library type-parameter bindings.',
    )
    assert(
      !genericBrandType.includes('"kind":"primitive","name":"string"'),
      'A constrained generic parameter must not collapse to its string constraint.',
    )
    const genericConditional = modulePayload.declarations.find(
      (entry) => entry.name === 'GenericConditional',
    )
    assert.equal(genericConditional?.authoredValueType?.kind, 'conditional')
    assert(
      JSON.stringify(genericConditional?.authoredValueType).includes('"kind":"parameter"'),
      'A direct conditional alias must retain its lexical type-parameter binding.',
    )
    assert.doesNotMatch(
      JSON.stringify(genericConditional),
      /"kind":"unsupported"/u,
      'A direct conditional alias binding must not produce an unsupported surface issue.',
    )
    const genericLookup = modulePayload.declarations.find((entry) => entry.name === 'GenericLookup')
    const genericLookupMethod = genericLookup?.callables?.find((entry) => entry.name === 'get')
    assert.equal(genericLookupMethod?.callable?.parameters[0]?.type.kind, 'parameter')
    assert.equal(genericLookupMethod?.callable?.returns.kind, 'indexed-access')
    assert.doesNotMatch(
      JSON.stringify(genericLookupMethod),
      /"kind":"unsupported"/u,
      'A generic interface method must bind its nested lexical parameter in arguments and returns.',
    )
    const conditionalKind = modulePayload.declarations.find(
      (entry) => entry.name === 'conditionalKind',
    )
    assert.equal(conditionalKind?.callable?.returns.kind, 'conditional')
    assert.doesNotMatch(
      JSON.stringify(conditionalKind),
      /"kind":"unsupported"/u,
      'A generic function conditional return must retain its callable-local binding.',
    )
    const brandedResult = modulePayload.declarations.find((entry) => entry.name === 'brandedResult')
    assert.deepEqual(brandedResult?.callable?.returns, {
      kind: 'reference',
      identity: genericBrand?.identity,
      name: 'GenericBrand',
      arguments: [{ kind: 'literal', value: 'Fixture' }],
    })
    const indexedResult = modulePayload.declarations.find((entry) => entry.name === 'indexedResult')
    assert.equal(indexedResult?.callable?.returns.kind, 'indexed-access')
    const optionalMode = modulePayload.declarations.find((entry) => entry.name === 'optionalMode')
    assert.deepEqual(optionalMode?.callable?.parameters[0]?.type, {
      kind: 'reference',
      identity: modulePayload.declarations.find((entry) => entry.name === 'AuthenticationMode')
        ?.identity,
      name: 'AuthenticationMode',
      arguments: [],
    })
    const instantiatedLazy = modulePayload.declarations.find(
      (entry) => entry.name === 'InstantiatedLazy',
    )
    assert.doesNotMatch(
      JSON.stringify(instantiatedLazy),
      /"kind":"unsupported"/u,
      'An instantiated generic callable alias must use the substituted Checker return.',
    )
    assert(
      JSON.stringify(instantiatedLazy).includes('"kind":"primitive","name":"string"'),
      'An instantiated generic callable alias must retain its concrete return type.',
    )
    const frozenSurface = modulePayload.declarations.find((entry) => entry.name === 'frozenSurface')
    assert.equal(frozenSurface?.valueType?.kind, 'object')
    assert.deepEqual(
      frozenSurface?.fields?.map((field) => field.name),
      ['match', 'name'],
      'An inferred generic Readonly wrapper without shim arguments must retain its resolved shape.',
    )
    assert.deepEqual(
      modulePayload.declarations
        .find((entry) => entry.name === 'PublicBox')
        ?.properties?.map((property) => property.name),
      ['value'],
      'ECMAScript private identifiers must never enter the public surface closure.',
    )
    assert.equal(
      modulePayload.declarations
        .find((entry) => entry.name === 'PublicBox')
        ?.callables?.find((member) => member.name === 'chain')?.callable?.returns.kind,
      'this',
      'Polymorphic this types must retain their public owner instead of becoming unsupported.',
    )
    const genericHandler = modulePayload.declarations.find(
      (entry) => entry.name === 'GenericHandler',
    )
    assert.equal(genericHandler?.valueType?.kind, 'function')
    if (genericHandler?.valueType?.kind === 'function') {
      assert.equal(genericHandler.valueType.callable.returns.kind, 'union')
      const serializedReturn = JSON.stringify(genericHandler.valueType.callable.returns)
      assert(
        serializedReturn.includes('"kind":"parameter"'),
        'An expanded generic alias must retain its unique caller type-parameter binding.',
      )
      assert(
        !serializedReturn.includes('"kind":"unsupported"'),
        'Checker-expanded generic alias constituents must not create an unbound parameter issue.',
      )
    }
    const choice = modulePayload.declarations.find((entry) => entry.name === 'SurfaceChoice')
    assert.equal(choice?.valueType?.kind, 'intersection')
    assert(
      choice?.valueType?.kind === 'intersection' &&
        choice.valueType.types.some(
          (type) => type.kind === 'reference' && type.name === 'BrandedText',
        ),
      'The canonical surface must retain an explicitly authored alias constituent.',
    )
    const recursiveValue = modulePayload.declarations.find(
      (entry) => entry.name === 'RecursiveValue',
    )
    assert.deepEqual(
      recursiveValue?.authoredValueType?.kind === 'union'
        ? recursiveValue.authoredValueType.types
            .filter((type) => type.kind === 'reference')
            .map((type) => type.name)
            .sort()
        : undefined,
      ['RecursiveArray', 'RecursiveObject'],
      'An authored union must retain recursive alias constituents instead of checker expansion.',
    )
    const broadString = modulePayload.declarations.find((entry) => entry.name === 'BroadString')
    assert.deepEqual(
      broadString?.authoredValueType,
      {
        kind: 'union',
        types: [
          { kind: 'literal', value: '*' },
          { kind: 'primitive', name: 'string' },
        ],
      },
      'An authored union must retain a literal constituent even when the checker subsumes it.',
    )
    assert.deepEqual(
      modulePayload.declarations
        .find((entry) => entry.name === 'TupleHolder')
        ?.properties?.find((property) => property.name === 'value')?.type,
      {
        kind: 'tuple',
        readonly: true,
        elements: [
          { kind: 'primitive', name: 'string' },
          { kind: 'primitive', name: 'number' },
        ],
      },
      'Tuple type syntax must normalize without calling TypeScript-Go partial initializer accessors.',
    )
    assert.equal(
      modulePayload.declarations.find((entry) => entry.name === 'StringMap')?.valueType?.kind,
      'record',
      'A pure authored index signature must be represented as a record without a V1 limitation diagnostic.',
    )
    assert.equal(
      modulePayload.declarations.find((entry) => entry.name === 'MergedSurface')?.kind,
      'interface',
      'A compatible interface and namespace merge must retain its public type facet.',
    )
    assert.deepEqual(modulePayload.issues, [])
    assert(modulePayload.files.includes('src/sdk/index.ts'))
    assert.deepEqual(
      modulePayload.inboundDependencies.map((edge) => ({
        sourceModule: edge.sourceModule,
        targetModule: edge.targetModule,
        kind: edge.kind,
        sourceFile: edge.sourceFile,
        targetFile: edge.targetFile,
        occurrences: edge.occurrences.map((occurrence) => ({
          typeOnly: occurrence.typeOnly,
          specifier: occurrence.specifier,
          deep: occurrence.deep,
          file: occurrence.location.file,
        })),
      })),
      [
        {
          sourceModule: 'unowned:src/cases.ts',
          targetModule: 'fixture.sdk',
          kind: 'runtime',
          sourceFile: 'src/cases.ts',
          targetFile: 'src/sdk/index.ts',
          occurrences: [
            {
              typeOnly: false,
              specifier: '@fixture/sdk',
              deep: false,
              file: 'src/cases.ts',
            },
          ],
        },
        {
          sourceModule: 'unowned:src/cases.ts',
          targetModule: 'fixture.sdk',
          kind: 'type',
          sourceFile: 'src/cases.ts',
          targetFile: 'src/sdk/index.ts',
          occurrences: [
            {
              typeOnly: true,
              specifier: '@fixture/sdk',
              deep: false,
              file: 'src/cases.ts',
            },
          ],
        },
      ],
      'A mixed import must retain separate runtime and type-only inbound relationships.',
    )
    const referencedDependency = modulePayload.dependencies.find(
      (edge) =>
        edge.targetModule === 'package:@fixture/referenced' &&
        edge.kind === 'runtime' &&
        edge.sourceFile === 'src/sdk/builder.ts',
    )
    assert(referencedDependency)
    assert.equal(referencedDependency.occurrences.length, 2)
    assert.equal(
      referencedDependency.id,
      typeScriptDependencyIdentity({
        sourceModule: referencedDependency.sourceModule,
        targetModule: referencedDependency.targetModule,
        kind: referencedDependency.kind,
        sourceFile: referencedDependency.sourceFile,
        targetFile: referencedDependency.targetFile,
      }),
    )
    assert.deepEqual(
      referencedDependency.occurrences.map((occurrence) => occurrence.id),
      [...referencedDependency.occurrences]
        .map((occurrence) => occurrence.id)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    )
    assert.equal(
      new Set(referencedDependency.occurrences.map((occurrence) => occurrence.id)).size,
      2,
    )
    const referencedAPI = modulePayload.dependencies.find(
      (edge) => edge.targetModule === 'package:@fixture/referenced' && edge.kind === 'api',
    )
    assert(referencedAPI)
    assert.deepEqual(
      referencedAPI.occurrences
        .map(
          (occurrence) =>
            modulePayload.declarations.find(
              (declaration) => declaration.identity === occurrence.declaration,
            )?.name,
        )
        .filter((name): name is string => name !== undefined)
        .sort(),
      ['ReferencedLeaf', 'ReferencedType'],
      'Public dependency closure must continue across an external owner and retain each contributing declaration occurrence.',
    )
    const platformAPI = modulePayload.dependencies.filter(
      (edge) => edge.targetModule === 'platform:typescript' && edge.kind === 'api',
    )
    assert(
      platformAPI.some((edge) =>
        edge.occurrences.some(
          (occurrence) => occurrence.declaration === 'platform:typescript#Date',
        ),
      ),
      'Platform declarations must retain platform ownership even when their physical provider is an ambient package.',
    )
    assert(
      !modulePayload.dependencies.some(
        (edge) =>
          edge.targetModule === 'package:node' &&
          edge.occurrences.some((occurrence) =>
            occurrence.declaration?.startsWith('platform:typescript#'),
          ),
      ),
      'Ambient provider layout must not turn platform identities into package dependencies.',
    )
    assert.deepEqual(modulePayload.declaredPackages, [])
    assert.deepEqual(modulePayload.developmentPackages, [])
    assert.deepEqual(modulePayload.workspacePackages, [])
    assert.deepEqual(modulePayload.errorCodes, [])
    const compilerDiagnostics = all.facts.filter(
      (fact) => fact.namespace === 'typescript.diagnostic',
    )
    assert.deepEqual(
      compilerDiagnostics.map((fact) => fact.payload),
      [],
      'The production native qualification fixture must typecheck without compiler diagnostics.',
    )
    assert(bodies.length > 0)
    const calls: {
      readonly target?: string
      readonly callbacks: readonly string[]
      readonly arguments: readonly string[]
    }[] = []
    const states = new Set<string>()
    let relations = 0
    let definitions = 0
    const flowEdges = new Set<string>()
    const completionCodes = new Set<string>()
    for (const fact of bodies) {
      const payload = fact.payload as {
        readonly body: Parameters<typeof validateFunctionBodyIR>[0]
        readonly values: Readonly<Record<string, { readonly kind: string }>>
      }
      assert.deepEqual(validateFunctionBodyIR(payload.body), [])
      calls.push(...payload.body.calls)
      relations += payload.body.relations.length
      definitions += payload.body.definitions.length
      for (const edge of payload.body.edges) flowEdges.add(edge.kind)
      for (const value of Object.values(payload.values)) states.add(value.kind)
      if (fact.completeness.kind === 'partial') {
        for (const reason of fact.completeness.reasons) completionCodes.add(reason.code)
      }
    }
    const sdkCalls = calls.filter((call) => call.target === sdkSymbols[0])
    assert.equal(sdkCalls.length, 9)
    assert(relations > 0)
    assert(definitions > 0)
    assert(calls.some((call) => call.callbacks.length > 0))
    assert(states.has('known'))
    assert(states.has('unknown'))
    assert(states.has('ambiguous'))
    assert(states.has('unsupported'))
    assert.deepEqual([...flowEdges].sort(), [
      'exception',
      'fallthrough',
      'false',
      'loop',
      'return',
      'true',
    ])
    const capabilities = await query.capabilities()
    assert.equal(
      capabilities.find((capability) => capability.capability === 'typescript.body')?.completeness
        .kind,
      'partial',
    )
    return {
      projectFacts: all.facts.filter((fact) => fact.namespace === 'typescript.project').length,
      diagnosticFacts: compilerDiagnostics.length,
      sourceFacts: all.facts.filter((fact) => fact.namespace === 'typescript.source').length,
      symbolFacts: all.facts.filter((fact) => fact.namespace === 'typescript.symbol').length,
      occurrenceFacts: all.facts.filter((fact) => fact.namespace === 'typescript.occurrence')
        .length,
      bodyFacts: bodies.length,
      moduleFacts: modules.length,
      moduleExports: modulePayload.exports.length,
      moduleDeclarations: modulePayload.declarations.length,
      callOccurrences: calls.length,
      sdkCallOccurrences: sdkCalls.length,
      bodyRelations: relations,
      conservativeDefinitionUses: definitions,
      controlFlowEdgeKinds: [...flowEdges].sort(),
      valueStates: [...states].sort(),
      bodyCompletionLimits: [...completionCodes].sort(),
    }
  } finally {
    await query.dispose()
  }
}

async function exportFacts(store: AnalysisStore, universe: ProjectUniverseId): Promise<unknown> {
  const query = await store.open(universe)
  try {
    const values = []
    for await (const fact of query.export()) values.push(fact)
    return values
  } finally {
    await query.dispose()
  }
}

async function modulePublicIdentities(
  store: AnalysisStore,
  universe: ProjectUniverseId,
  module: string,
): Promise<Readonly<Record<string, string>>> {
  const query = await store.open(universe)
  try {
    const result = await query.facts(
      { namespaces: ['astrale.typescript.module'], subjects: [module] },
      { limit: 2 },
    )
    assert.equal(result.facts.length, 1)
    const payload = result.facts[0]!.payload as {
      readonly exports: readonly {
        readonly path: readonly string[]
        readonly declaration: string
      }[]
    }
    return Object.fromEntries(
      payload.exports
        .map((entry) => [entry.path.join('.'), entry.declaration] as const)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    )
  } finally {
    await query.dispose()
  }
}

async function assertProductionColdEquivalent(
  binary: string,
  root: string,
  universe: ProjectUniverseId,
  expectedStore: AnalysisStore,
): Promise<void> {
  const store = createMemoryAnalysisStore()
  const service = await createTypeScriptAnalysisService({
    project: {
      root,
      config: 'tsconfig.json',
      capabilities: productionNativeCapabilities,
      modules: productionNativeModules,
    },
    sessions: createProcessNativeAnalysisSessionFactory({ command: binary }),
    store,
  })
  try {
    const cold = await service.refresh()
    assert.equal(cold.generation.universe, universe)
    const expected = await expectedStore.current(universe)
    assert(expected)
    const coldFacts = await exportFacts(store, universe)
    const expectedFacts = await exportFacts(expectedStore, universe)
    assert.deepEqual(
      factsWithoutGeneration(coldFacts),
      factsWithoutGeneration(expectedFacts),
      'A cold rebuild and incremental refresh must publish the same semantic facts.',
    )
    assert.deepEqual(
      {
        producer: cold.generation.producer,
        sourceManifest: cold.generation.sourceManifest,
        capabilities: cold.generation.capabilities,
      },
      {
        producer: expected.producer,
        sourceManifest: expected.sourceManifest,
        capabilities: expected.capabilities,
      },
      'A cold rebuild and incremental refresh must derive the same semantic generation inputs.',
    )
    assert.equal(cold.generation.id, expected?.id)
    assert.deepEqual(coldFacts, expectedFacts)
  } finally {
    await service.dispose()
    await store.dispose()
  }
}

function factsWithoutGeneration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(factsWithoutGeneration)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'generation' ? '<generation>' : factsWithoutGeneration(entry),
    ]),
  )
}

function runNative(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.once('error', rejectRun)
    child.once('close', (code) => resolveRun({ code: code ?? 1, stdout, stderr }))
  })
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function wireDigest(value: unknown): string {
  const goJson = JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, (character) => {
    if (character === '<') return '\\u003c'
    if (character === '>') return '\\u003e'
    if (character === '&') return '\\u0026'
    if (character === '\u2028') return '\\u2028'
    return '\\u2029'
  })
  return createHash('sha256').update(goJson).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

function byKey(left: { readonly key: string }, right: { readonly key: string }): number {
  return left.key.localeCompare(right.key)
}

function transactionSize(transaction: {
  readonly upserts: readonly unknown[]
  readonly deletes: readonly unknown[]
  readonly manifest: readonly unknown[]
}): Record<string, number> {
  return {
    upserts: transaction.upserts.length,
    deletes: transaction.deletes.length,
    manifest: transaction.manifest.length,
  }
}

await main()

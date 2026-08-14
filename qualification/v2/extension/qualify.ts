import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  deriveAnalysisId,
  createProcessNativeAnalysisSessionFactory,
  runAnalysisPolicies,
  type AnalysisGeneration,
  type AnalysisStore,
  type Fact,
  type ProducerIdentity,
} from '../../../analysis/index.ts'
import { createMemoryAnalysisStore } from '../../../analysis/memory/index.ts'
import { createSQLiteAnalysisStore } from '../../../analysis/sqlite/index.ts'
import {
  createTypeScriptAnalysisPipeline,
  type TypeScriptBodyFacts,
  type TypeScriptAnalysisService,
} from '../../../analysis/typescript/index.ts'

import type * as Consumer from './consumer/index.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const specificationPackageRoot = resolve(repositoryRoot, 'spec')
const fixtureSource = resolve(import.meta.dirname, '../ttsc/fixtures/adversarial')
const consumerSource = resolve(import.meta.dirname, 'consumer')
const evidencePath = resolve(
  specificationPackageRoot,
  '.history/v2/evidence/sdk-extension-qualification.json',
)
const writeEvidence = process.argv.includes('--write')
const nativeBinary = argument('--native-binary')

const nativeCapabilities = [
  'typescript.project',
  'typescript.diagnostic',
  'typescript.source',
  'typescript.symbol',
  'typescript.occurrence',
  'typescript.body',
  'astrale.typescript.module',
] as const

const nativeModules = [
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

const producer: ProducerIdentity = {
  id: deriveAnalysisId('producer', 'fixture.sdk.extension', { version: 1 }),
  name: 'fixture-sdk-extension',
  version: '1.0.0',
  protocolVersion: 1,
}

if (!nativeBinary) {
  throw new Error(
    'Usage: node qualify.ts --native-binary <qualified-native-binary> [--write]',
  )
}

interface ConsumerModule {
  readonly SDK_BUILDER_CAPABILITY: typeof Consumer.SDK_BUILDER_CAPABILITY
  readonly SDK_BUILDER_FACT_NAMESPACE: typeof Consumer.SDK_BUILDER_FACT_NAMESPACE
  readonly createSDKBuilderAnalysisPass: typeof Consumer.createSDKBuilderAnalysisPass
  readonly createSDKBuilderQualificationPolicy: typeof Consumer.createSDKBuilderQualificationPolicy
}

interface PipelineFixture {
  readonly service: TypeScriptAnalysisService
  readonly store: AnalysisStore
}

async function main(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'astrale-typespec-v2-extension-'))
  try {
    const consumer = await loadExternalConsumer(temporary)
    const rootA = join(temporary, 'root-a')
    const rootB = join(temporary, 'root-b')
    const rootCold = join(temporary, 'root-cold')
    await Promise.all([
      cp(fixtureSource, rootA, { recursive: true }),
      cp(fixtureSource, rootB, { recursive: true }),
    ])

    const timings: Record<string, number> = {}
    const memoryA = await createFixture(rootA, createMemoryAnalysisStore({ maximumRetainedGenerations: 8 }), consumer)
    try {
      const initialStarted = performance.now()
      const initial = await memoryA.service.refresh()
      timings.coldMemoryMs = round(performance.now() - initialStarted)
      const initialProof = await inspect(memoryA.store, initial.generation, consumer)
      assert.equal(
        initialProof.policyStatus,
        'pass',
        JSON.stringify({
          summary: initialProof.summary,
          valueStates: initialProof.valueStates,
          knownValues: initialProof.knownValues,
          callbackKinds: initialProof.callbackKinds,
          callbacks: initialProof.callbacks,
          callDetails: initialProof.callDetails,
          bodySummaries: initialProof.bodySummaries,
          policyRules: initialProof.policyRules,
        }),
      )
      assert.equal(initialProof.capabilityCompleteness, 'complete')
      assert.equal(initialProof.bodyCompleteness, 'partial')

      const warmStarted = performance.now()
      const warm = await memoryA.service.refresh()
      timings.warmMemoryMs = round(performance.now() - warmStarted)
      assert.equal(warm.transaction, undefined)
      assert.deepEqual(warm.invalidatedPasses, [])
      assert.equal(warm.generation.id, initial.generation.id)

      const sqliteFile = join(temporary, 'extension.sqlite')
      const sqlite = await createSQLiteAnalysisStore({
        file: sqliteFile,
        namespace: 'sdk-extension',
        maximumRetainedGenerations: 4,
      })
      const sqliteFixture = await createFixture(rootB, sqlite, consumer)
      let sqliteGeneration: AnalysisGeneration
      let sqliteFacts: readonly Fact[]
      try {
        const started = performance.now()
        const refreshed = await sqliteFixture.service.refresh()
        timings.coldSQLiteMs = round(performance.now() - started)
        sqliteGeneration = refreshed.generation
        const proof = await inspect(sqlite, refreshed.generation, consumer)
        assert.equal(proof.policyStatus, 'pass')
        sqliteFacts = proof.extensionFacts
        assert.deepEqual(portable(initialProof.extensionFacts), portable(sqliteFacts))
        assert.equal(initial.generation.id, sqliteGeneration.id)
      } finally {
        await sqliteFixture.service.dispose()
        await sqlite.dispose()
      }

      const reopened = await createSQLiteAnalysisStore({
        file: sqliteFile,
        namespace: 'sdk-extension',
        maximumRetainedGenerations: 4,
      })
      try {
        const persisted = await exportFacts(reopened, sqliteGeneration!)
        assert.deepEqual(portable(persisted.filter(isExtensionFact)), portable(sqliteFacts!))
      } finally {
        await reopened.dispose()
      }

      const casesPath = join(rootA, 'src/cases.ts')
      const before = await readFile(casesPath, 'utf8')
      await writeFile(casesPath, before.replace("name: 'known'", "name: 'known-edited'"), 'utf8')
      const editStarted = performance.now()
      const edited = await memoryA.service.refresh({ changed: ['src/cases.ts'] })
      timings.incrementalEditMs = round(performance.now() - editStarted)
      assert(edited.transaction)
      assert(edited.invalidatedPasses.some((pass) => pass === consumerPassId(consumer)))
      const editedProof = await inspect(memoryA.store, edited.generation, consumer, 'known-edited')
      assert.equal(editedProof.policyStatus, 'pass')

      await cp(rootA, rootCold, { recursive: true })
      const cold = await createFixture(rootCold, createMemoryAnalysisStore(), consumer)
      try {
        const started = performance.now()
        const rebuilt = await cold.service.refresh()
        timings.coldRebuildMs = round(performance.now() - started)
        const coldProof = await inspect(cold.store, rebuilt.generation, consumer, 'known-edited')
        assert.equal(coldProof.policyStatus, 'pass')
        assert.equal(rebuilt.generation.id, edited.generation.id)
        assert.deepEqual(portable(coldProof.allFacts), portable(editedProof.allFacts))
      } finally {
        await cold.service.dispose()
        await cold.store.dispose()
      }

      const evidence = {
        format: 'astrale.typespec.v2.sdk-extension-qualification',
        version: 1,
        status: 'qualified',
        consumer: {
          imports: ['@astrale-os/codegraph/analysis', '@astrale-os/codegraph/analysis/typescript'],
          privateImports: 0,
          externalPackageBoundaryLoaded: true,
        },
        semantics: {
          canonicalIdentity: true,
          sameNameCollisionRejected: true,
          directCalls: initialProof.summary.directCalls,
          forwardedCalls: initialProof.summary.forwardedCalls,
          valueStates: initialProof.valueStates,
          callbackKinds: initialProof.callbackKinds,
          partialNativeBodyScopedToCompleteSDKFacts: true,
        },
        materialization: {
          twoRootPortableIdentity: true,
          sqliteReopenEquivalent: true,
          incrementalEqualsCold: true,
          noChangeReusedGeneration: true,
          unrelatedCapabilityName: consumer.SDK_BUILDER_CAPABILITY,
          outputNamespace: consumer.SDK_BUILDER_FACT_NAMESPACE,
        },
        performance: {
          ...timings,
          sqliteBytes: (await stat(sqliteFile)).size,
        },
      }
      if (writeEvidence) {
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
      }
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    } finally {
      await memoryA.service.dispose()
      await memoryA.store.dispose()
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function loadExternalConsumer(temporary: string): Promise<ConsumerModule> {
  const installed = join(temporary, 'external-consumer')
  const packageDirectory = join(installed, 'node_modules/@astrale-os/codegraph')
  await Promise.all([
    cp(consumerSource, join(installed, 'src'), { recursive: true }),
    mkdir(dirname(packageDirectory), { recursive: true }),
  ])
  await symlink(specificationPackageRoot, packageDirectory, 'dir')
  const imported = (await import(pathToFileURL(join(installed, 'src/index.ts')).href)) as ConsumerModule
  assert.equal(typeof imported.createSDKBuilderAnalysisPass, 'function')
  assert.equal(typeof imported.createSDKBuilderQualificationPolicy, 'function')
  return imported
}

async function createFixture(
  root: string,
  store: AnalysisStore,
  consumer: ConsumerModule,
): Promise<PipelineFixture> {
  const selector: Consumer.SDKBuilderSelector = {
    declarationPath: 'src/sdk/builder.ts',
    exportName: 'defineMutation',
    valueProperty: 'name',
    callbackProperty: 'run',
    maximumForwardingDepth: 1,
    maximumCalls: 64,
  }
  const pass = consumer.createSDKBuilderAnalysisPass(selector)
  const service = await createTypeScriptAnalysisPipeline({
    project: {
      root,
      config: 'tsconfig.json',
      capabilities: nativeCapabilities,
      modules: nativeModules,
    },
    sessions: createProcessNativeAnalysisSessionFactory({ command: nativeBinary! }),
    store,
    passes: [pass],
    requestedCapabilities: [consumer.SDK_BUILDER_CAPABILITY],
    producer,
  })
  return { service, store }
}

async function inspect(
  store: AnalysisStore,
  generation: AnalysisGeneration,
  consumer: ConsumerModule,
  knownCaseValue = 'known',
): Promise<{
  readonly allFacts: readonly Fact[]
  readonly extensionFacts: readonly Fact[]
  readonly summary: Consumer.SDKBuilderSummaryPayload
  readonly valueStates: readonly string[]
  readonly knownValues: readonly string[]
  readonly callbackKinds: readonly string[]
  readonly callbacks: readonly Consumer.SDKBuilderCallbackFact[]
  readonly callDetails: readonly unknown[]
  readonly bodySummaries: readonly unknown[]
  readonly capabilityCompleteness: string
  readonly bodyCompleteness: string
  readonly policyStatus: string
  readonly policyRules: readonly unknown[]
}> {
  const query = await store.open(generation.universe, generation.id)
  try {
    const allFacts = await collect(query.export())
    const extensionFacts = allFacts.filter(isExtensionFact)
    const summaries = extensionFacts.filter(
      (fact): fact is Fact<Consumer.SDKBuilderSummaryPayload> =>
        (fact.payload as { readonly kind?: string }).kind === 'builder-summary',
    )
    const calls = extensionFacts.filter(
      (fact): fact is Fact<Consumer.SDKBuilderCallPayload> =>
        (fact.payload as { readonly kind?: string }).kind === 'builder-call',
    )
    assert.equal(summaries.length, 1)
    assert.equal(calls.length, 10)
    const expectation: Consumer.SDKBuilderPolicyExpectation = {
      directCalls: 9,
      forwardedCalls: 1,
      minimumRejectedCollisions: 1,
      valueStates: ['ambiguous', 'known', 'unknown', 'unsupported'],
      knownValues: [
        knownCaseValue,
        'template-known',
        'returned',
        'closure',
        'forwarded',
        'first',
        'second',
      ],
      callbackKinds: ['direct', 'returned'],
    }
    const policy = await runAnalysisPolicies({
      query,
      policies: [consumer.createSDKBuilderQualificationPolicy(expectation)],
    })
    const capabilities = await query.capabilities()
    const capability = capabilities.find(
      (value) => value.capability === consumer.SDK_BUILDER_CAPABILITY,
    )
    const bodyCompleteness = mergeCompleteness(
      allFacts
        .filter((fact) => fact.namespace === 'typescript.body')
        .map((fact) => fact.completeness),
    )
    return {
      allFacts,
      extensionFacts,
      summary: summaries[0]!.payload,
      valueStates: unique(calls.map((fact) => fact.payload.value.kind)),
      knownValues: unique(
        calls.flatMap((fact) =>
          fact.payload.value.kind === 'known' && typeof fact.payload.value.value === 'string'
            ? [fact.payload.value.value]
            : [],
        ),
      ),
      callbackKinds: unique(
        calls.flatMap((fact) => fact.payload.callbacks.map((callback) => callback.kind)),
      ),
      callbacks: calls.flatMap((fact) => fact.payload.callbacks),
      callDetails: calls.map((fact) => ({
        call: fact.payload.call,
        source: fact.payload.source,
        value: fact.payload.value,
        callbacks: fact.payload.callbacks,
      })),
      bodySummaries: allFacts
        .filter((fact) => fact.namespace === 'typescript.body')
        .map((fact) => {
          const payload = fact.payload as TypeScriptBodyFacts
          return {
            function: payload.body.function,
            evidence: fact.provenance.evidence,
            returns: payload.body.summary.returns,
          }
        }),
      capabilityCompleteness: capability?.completeness.kind ?? 'missing',
      bodyCompleteness: bodyCompleteness.kind,
      policyStatus: policy.policies[0]?.status ?? 'missing',
      policyRules: policy.policies[0]?.rules ?? [],
    }
  } finally {
    await query.dispose()
  }
}

async function exportFacts(
  store: AnalysisStore,
  generation: AnalysisGeneration,
): Promise<readonly Fact[]> {
  const query = await store.open(generation.universe, generation.id)
  try {
    return await collect(query.export())
  } finally {
    await query.dispose()
  }
}

function isExtensionFact(fact: Fact): boolean {
  return fact.namespace === 'fixture.sdk.builder-call'
}

function portable(facts: readonly Fact[]): unknown {
  return facts
    .map(({ generation: _generation, ...fact }) => fact)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function consumerPassId(consumer: ConsumerModule): string {
  return consumer.createSDKBuilderAnalysisPass({
    declarationPath: 'src/sdk/builder.ts',
    exportName: 'defineMutation',
    valueProperty: 'name',
    callbackProperty: 'run',
    maximumForwardingDepth: 1,
    maximumCalls: 64,
  }).manifest.id
}

function mergeCompleteness(
  values: readonly Fact['completeness'][],
): Fact['completeness'] {
  const unavailable = values.flatMap((value) =>
    value.kind === 'unavailable' ? value.reasons : [],
  )
  if (unavailable.length) return { kind: 'unavailable', reasons: unavailable }
  const partial = values.flatMap((value) => (value.kind === 'partial' ? value.reasons : []))
  return partial.length ? { kind: 'partial', reasons: partial } : { kind: 'complete' }
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const result: Value[] = []
  for await (const value of values) result.push(value)
  return result
}

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort()
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

await main()

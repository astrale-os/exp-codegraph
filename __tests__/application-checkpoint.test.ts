import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import type {
  ApplicationAnalysisRefreshOptions,
  ApplicationAnalysisWorkspace,
} from '../application/analysis/index.ts'
import type { ConformanceProfile } from '../conformance/index.ts'
import { createMemoryAnalysisStore } from '../analysis/index.ts'
import {
  admitApplicationCheckpointManifest,
  applicationCheckpointCorpus,
  applicationCheckpointScope,
  createApplicationCheckpoint,
} from '../application/checkpoint/index.ts'
import {
  codegraphProducerFingerprint,
  createNodeTypeSpecApplicationService,
} from '../application/node/index.ts'
import { createTypeSpecApplicationServiceWithDependencies } from '../application/service.ts'
import { createSpecificationValidityConformanceProfile } from '../conformance/index.ts'
import {
  createFileWorkspaceCheckpointStore,
  decodeWorkspaceCheckpointJson,
  encodeWorkspaceCheckpointJson,
  type FileWorkspaceCheckpointStore,
} from '../workspace/checkpoint/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('application workspace checkpoint', () => {
  /** @evidence APPLICATION-PORTABLE-CHECKPOINT-ADMISSION */
  it('reopens a proof-bound portable checkpoint read-only without compilation or ownership transfer', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/portable-checkpoint', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const physical = await fixture({})
    fixtures.push(current, physical)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(physical.root, 'semantic-pack'),
      maxArtifacts: 4_096,
    })
    const sourceProof = 'source-proof:portable-fixture'
    const first = await createNodeTypeSpecApplicationService({
      root: current.root,
      cacheDirectory: join(physical.root, 'producer-cache'),
      persistence: 'memory',
      portableCheckpoint: { store, sourceProof, writable: true },
    })
    const initial = await first.refresh({ requestedCapabilities: [] })
    await first.dispose()

    const producerFingerprint = `${await codegraphProducerFingerprint()}:application-checkpoint/4`
    const manifest = await admitApplicationCheckpointManifest(
      { store, producerFingerprint },
      {
        repository: initial.snapshot.repository,
        inventory: initial.snapshot.inventory,
        corpus: applicationCheckpointCorpus([]),
        sourceProof,
      },
    )
    expect(manifest).toMatchObject({
      ok: true,
      reference: {
        scope: expect.stringMatching(/^application-[0-9a-f]{32}$/u),
        manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    })
    if (!manifest.ok) return
    const codec = createApplicationCheckpoint({ store, producerFingerprint })
    await expect(codec.load({
      repository: initial.snapshot.repository,
      inventory: initial.snapshot.inventory,
      corpus: applicationCheckpointCorpus([]),
      request: 'irrelevant-after-invalid-manifest',
      sourceProof,
      manifestSha256: '0'.repeat(64),
    })).resolves.toEqual({ ok: false, reason: 'incompatible' })

    const before = await store.load(manifest.reference.scope, { artifactKeys: [] })
    const events: import('../analysis/index.ts').AnalysisTelemetryEvent[] = []
    const second = await createNodeTypeSpecApplicationService({
      root: current.root,
      cacheDirectory: join(physical.root, 'consumer-cache'),
      persistence: 'memory',
      portableCheckpoint: {
        store,
        sourceProof,
        writable: false,
        reference: manifest.reference,
      },
      telemetry: (event) => events.push(event),
    })
    const restored = await second.refresh({ requestedCapabilities: [] })
    expect(restored.snapshot).toEqual(initial.snapshot)
    expect(restored.timing.compileMs).toBe(0)
    expect(await second.settle()).toEqual({})
    await second.dispose()
    expect(await store.load(manifest.reference.scope, { artifactKeys: [] })).toEqual(before)
    expect(events).toContainEqual(expect.objectContaining({
      phase: 'application.checkpoint',
      metrics: expect.objectContaining({ status: 'completed', outcome: 'hit' }),
    }))
    await store.dispose()
  })

  it('keeps the Node-owned checkpoint store alive while disposal drains publication', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/node-checkpoint-disposal', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    fixtures.push(current)
    const cacheDirectory = join(current.root, '.cache', 'codegraph')
    const first = await createNodeTypeSpecApplicationService({
      root: current.root,
      cacheDirectory,
      persistence: 'advisory',
    })
    const initial = await first.refresh({ requestedCapabilities: [] })
    await first.dispose()

    const events: import('../analysis/index.ts').AnalysisTelemetryEvent[] = []
    const second = await createNodeTypeSpecApplicationService({
      root: current.root,
      cacheDirectory,
      persistence: 'advisory',
      telemetry: (event) => events.push(event),
    })
    try {
      const restored = await second.refresh({ requestedCapabilities: [] })
      expect(restored.snapshot).toEqual(initial.snapshot)
      expect(restored.timing.compileMs).toBe(0)
      expect(events).toContainEqual(
        expect.objectContaining({
          phase: 'application.checkpoint',
          metrics: expect.objectContaining({ status: 'completed', outcome: 'hit' }),
        }),
      )
    } finally {
      await second.dispose()
    }
  })

  it('reopens an unchanged application without discovery, compilation, statistics, or analysis', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const firstAnalysis = emptyAnalysisWorkspace()
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: firstAnalysis, profiles: [], checkpoint },
    )
    const initial = await first.refresh()
    await first.dispose()

    const compile = vi.fn(async () => {
      throw new Error('cold compilation must not run')
    })
    const secondAnalysis = emptyAnalysisWorkspace()
    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: secondAnalysis,
        profiles: [],
        checkpoint,
        discover: vi.fn(async () => {
          throw new Error('discovery must not run')
        }),
        compile,
        statistics: vi.fn(async () => {
          throw new Error('statistics must not run')
        }),
      },
    )
    try {
      const restored = await second.refresh()
      expect(restored.snapshot).toEqual(initial.snapshot)
      expect(restored.timing).toMatchObject({
        discoverMs: 0,
        compileMs: 0,
        statisticsMs: 0,
        analysisMs: 0,
        qualificationMs: 0,
      })
      expect(compile).not.toHaveBeenCalled()
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })

  it('reopens an exact capability-minimal checkpoint without a statistics artifact', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-no-statistics', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [], checkpoint },
    )
    const initial = await first.refresh({ requestedCapabilities: [] })
    expect(initial.snapshot.statistics).toBeUndefined()
    expect(await first.settle()).toMatchObject({ checkpoint: { outcome: 'published' } })
    await first.dispose()

    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [],
        checkpoint,
        compile: vi.fn(async () => {
          throw new Error('capability-minimal checkpoint must not compile')
        }),
        statistics: vi.fn(async () => {
          throw new Error('capability-minimal checkpoint must not compute statistics')
        }),
      },
    )
    try {
      const restored = await second.refresh({ requestedCapabilities: [] })
      expect(restored.snapshot).toEqual(initial.snapshot)
      expect(restored.timing).toMatchObject({ compileMs: 0, statisticsMs: 0 })
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })

  it('publishes and reopens diagnostic-rich snapshots whose optional pointers are absent', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-diagnostic', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
      'module/.spec/packages/example.ts': '',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [createSpecificationValidityConformanceProfile()],
        checkpoint,
      },
    )
    const initial = await first.refresh({ qualify: true, compilerAnalysis: false })
    const diagnostic = initial.snapshot.qualifications
      .flatMap((qualification) => qualification.profiles)
      .flatMap((profile) => profile.rules)
      .flatMap((rule) => rule.diagnostics)
      .find((entry) => entry.code === 'PACKAGE_DEFINITION_MISSING')
    expect(diagnostic).toBeDefined()
    expect(diagnostic).not.toHaveProperty('specificationPointer')
    expect(await first.settle()).toMatchObject({ checkpoint: { outcome: 'published' } })
    await first.dispose()

    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [createSpecificationValidityConformanceProfile()],
        checkpoint,
        compile: vi.fn(async () => {
          throw new Error('diagnostic-rich checkpoint must reopen without compilation')
        }),
      },
    )
    try {
      const restored = await second.refresh({ qualify: true, compilerAnalysis: false })
      expect(restored.snapshot).toEqual(initial.snapshot)
      expect(restored.timing.compileMs).toBe(0)
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })

  it('returns an attributable receipt when advisory publication is unavailable', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-unavailable', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    fixtures.push(current)
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [],
        checkpoint: {
          async load() {
            return { ok: false, reason: 'missing' }
          },
          async publish() {
            throw new Error('fixture publication failed')
          },
        },
      },
    )
    try {
      const refreshed = await service.refresh()
      expect(refreshed.snapshot.specifications).toHaveLength(1)
      expect(await service.settle()).toMatchObject({
        checkpoint: {
          repository: refreshed.snapshot.repository,
          inventory: refreshed.snapshot.inventory,
          outcome: 'unavailable',
          error: {
            code: 'APPLICATION_CHECKPOINT_PUBLICATION_UNAVAILABLE',
            name: 'Error',
            message: 'fixture publication failed',
          },
        },
      })
    } finally {
      await service.dispose()
    }
  })

  it('publishes the successful incremental result for the next unchanged process', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-edit', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [], checkpoint },
    )
    await first.refresh()
    await writeFile(
      join(current.root, 'module/.spec/api.d.ts'),
      'export interface Value { readonly id: string; readonly name: string }\n',
    )
    const edited = await first.refresh({ changed: ['module/.spec/api.d.ts'] })
    await first.dispose()

    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [],
        checkpoint,
        discover: vi.fn(async () => {
          throw new Error('the edited checkpoint must restore without discovery')
        }),
      },
    )
    try {
      expect((await second.refresh()).snapshot.id).toBe(edited.snapshot.id)
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })

  it('reuses unchanged specification-local qualifications from a same-request corpus hit', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-local-reuse', type: 'module' }),
      'left/.spec/api.d.ts': 'export interface Left {}\n',
      'left/.spec/architecture.md': '# Left\n',
      'right/.spec/api.d.ts': 'export interface Right {}\n',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const evaluated: string[] = []
    const profile: ConformanceProfile = {
      manifest: {
        id: 'fixture.local-reuse',
        version: '1',
        dependsOn: [],
        requiresCapabilities: [],
        rules: ['FIXTURE-LOCAL-REUSE'],
        evaluationScope: 'specification',
      },
      async evaluate(context) {
        evaluated.push(context.specification.source)
        return [
          {
            rule: 'FIXTURE-LOCAL-REUSE',
            status: 'pass',
            diagnostics: [],
            coverage: {
              forward: { matched: 1, total: 1 },
              inverse: { matched: 1, total: 1 },
            },
          },
        ]
      },
    }
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [profile], checkpoint },
    )
    await first.refresh({ qualify: true, compilerAnalysis: false })
    await first.dispose()
    expect(evaluated).toEqual(['left/.spec/api.d.ts', 'right/.spec/api.d.ts'])
    evaluated.length = 0

    await writeFile(join(current.root, 'left/.spec/architecture.md'), '# Left revised\n')
    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [profile], checkpoint },
    )
    try {
      const refreshed = await second.refresh({ qualify: true, compilerAnalysis: false })
      expect(refreshed.changes.specifications.refreshed).toEqual(['left/.spec/api.d.ts'])
      expect(evaluated).toEqual(['left/.spec/api.d.ts'])
      expect(await second.settle()).toMatchObject({ checkpoint: { outcome: 'published' } })
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })

  it('reuses one compiled corpus across application request variants', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-corpus', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [], checkpoint },
    )
    await first.refresh({ qualify: true })
    await first.dispose()

    const compile = vi.fn(async () => {
      throw new Error('a request variant must reuse the compiled corpus')
    })
    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [],
        checkpoint,
        discover: vi.fn(async () => {
          throw new Error('a request variant must reuse discovery')
        }),
        compile,
        statistics: vi.fn(async () => {
          throw new Error('a request variant must reuse statistics')
        }),
      },
    )
    try {
      const restored = await second.refresh({ qualify: true, focused: true, select: ['module'] })
      expect(restored.timing).toMatchObject({
        discoverMs: 0,
        compileMs: 0,
        statisticsMs: 0,
      })
      expect(compile).not.toHaveBeenCalled()
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })

  /** @evidence APPLICATION-CHECKPOINT-REQUEST-PROJECTION */
  it('loads only a selected dependency closure and ignores an omitted corrupt owner', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-projection', type: 'module' }),
      'shared/.spec/api.d.ts': 'export interface Shared { readonly id: string }\n',
      'left/.spec/api.d.ts': [
        "import type { Shared } from '../../shared/.spec/api.d.ts'",
        'export interface Left { readonly shared: Shared }',
        '',
      ].join('\n'),
      'right/.spec/api.d.ts': 'export interface Right { readonly unrelated: true }\n',
    })
    fixtures.push(current)
    const directory = join(current.root, '.cache', 'checkpoint-projection')
    const store = createFileWorkspaceCheckpointStore({ directory })
    const producerFingerprint = 'fixture-projection-v1'
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint })
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [], checkpoint },
    )
    const initial = await first.refresh({ requestedCapabilities: [] })
    await first.dispose()

    const corpus = applicationCheckpointCorpus([])
    const scope = applicationCheckpointScope({ corpus })
    const stored = await store.load(scope)
    expect(stored.ok).toBe(true)
    if (!stored.ok) return
    const corpusBytes = stored.artifacts.get('corpus/index.json.br')
    expect(corpusBytes).toBeDefined()
    const index = decodeWorkspaceCheckpointJson(corpusBytes!, {
      maximumDecodedBytes: 64 * 1024 * 1024,
    }).value as readonly {
      readonly source: string
      readonly key: string
    }[]
    const rightKey = index.find(({ source }) => source === 'right/.spec/api.d.ts')?.key
    const leftKey = index.find(({ source }) => source === 'left/.spec/api.d.ts')?.key
    expect(rightKey).toBeDefined()
    expect(leftKey).toBeDefined()
    const rightArtifact = stored.manifest.artifacts.find(({ key }) => key === rightKey)
    expect(rightArtifact).toBeDefined()
    const packedLeft = decodeWorkspaceCheckpointJson(stored.artifacts.get(leftKey!)!, {
      maximumDecodedBytes: 64 * 1024 * 1024,
    }).value as Record<string, unknown>
    const forgedArtifacts = new Map(stored.artifacts)
    forgedArtifacts.set(leftKey!, encodeWorkspaceCheckpointJson(
      { ...packedLeft, title: 'forged-with-stale-identity' },
      { maximumDecodedBytes: 64 * 1024 * 1024 },
    ).value)
    const {
      scope: _storedScope,
      artifacts: _storedDescriptors,
      ...manifestInput
    } = stored.manifest
    await store.publish(scope, { manifest: manifestInput, artifacts: forgedArtifacts })
    const projectionExpectation = {
      repository: initial.snapshot.repository,
      inventory: initial.snapshot.inventory,
      corpus,
      request: 'focused-request',
      projection: {
        requested: ['left'],
        includeDependents: false,
        capabilities: [],
      },
    } as const
    await expect(createApplicationCheckpoint({ store, producerFingerprint }).load(
      projectionExpectation,
    )).resolves.toEqual({ ok: false, reason: 'corrupt' })
    await store.publish(scope, { manifest: manifestInput, artifacts: stored.artifacts })
    await writeFile(join(directory, 'blobs', 'sha256', rightArtifact!.digest), 'corrupt')

    const selections: (readonly string[] | undefined)[] = []
    const recordingStore: FileWorkspaceCheckpointStore = {
      load(requestedScope, options) {
        selections.push(options?.artifactKeys)
        return store.load(requestedScope, options)
      },
      publish: (...arguments_) => store.publish(...arguments_),
      remove: (...arguments_) => store.remove(...arguments_),
      async dispose() {},
    }
    const loaded = await createApplicationCheckpoint({
      store: recordingStore,
      producerFingerprint,
    }).load(projectionExpectation)
    expect(loaded).toMatchObject({ ok: true, exact: false })
    if (!loaded.ok) return
    expect(loaded.work).toMatchObject({
      projection: 'request-closure',
      specifications: 2,
      apiPayloads: 0,
    })
    expect(loaded.work.artifacts).toBeLessThan(stored.manifest.artifacts.length)
    expect(loaded.work.decodedBytes).toBeGreaterThan(0)
    expect(loaded.content.snapshot).toBeUndefined()
    expect(loaded.content.complete).toBe(false)
    expect(loaded.content.specifications.map(({ source }) => source)).toEqual([
      'left/.spec/api.d.ts',
      'shared/.spec/api.d.ts',
    ])
    expect(selections.some((keys) => keys?.includes(rightKey!))).toBe(false)
    await expect(createApplicationCheckpoint({
      store: recordingStore,
      producerFingerprint,
    }).load({
      repository: initial.snapshot.repository,
      inventory: initial.snapshot.inventory,
      corpus,
      request: 'corrupt-focused-request',
      projection: {
        requested: ['right'],
        includeDependents: false,
        capabilities: [],
      },
    })).resolves.toEqual({ ok: false, reason: 'corrupt' })
    await store.dispose()
  })

  it('uses an older inventory checkpoint as a delta corpus instead of recompiling all owners', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/checkpoint-delta', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
      'notes.md': 'before\n',
    })
    fixtures.push(current)
    const store = createFileWorkspaceCheckpointStore({
      directory: join(current.root, '.cache', 'checkpoint'),
    })
    const checkpoint = createApplicationCheckpoint({ store, producerFingerprint: 'fixture-v1' })
    const first = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [], checkpoint },
    )
    await first.refresh()
    await first.dispose()
    await writeFile(join(current.root, 'notes.md'), 'after\n')

    const compile = vi.fn(async () => {
      throw new Error('an unrelated edit must not recompile specification owners')
    })
    const second = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [], checkpoint, compile },
    )
    try {
      const refreshed = await second.refresh()
      expect(refreshed.snapshot.specifications).toHaveLength(1)
      expect(compile).not.toHaveBeenCalled()
    } finally {
      await second.dispose()
      await store.dispose()
    }
  })
})

function emptyAnalysisWorkspace(): ApplicationAnalysisWorkspace {
  const store = createMemoryAnalysisStore()
  let disposed = false
  return {
    async open(generations, inventory) {
      if (disposed) throw new Error('analysis disposed')
      return store.snapshotSet(generations, inventory)
    },
    async refresh(options: ApplicationAnalysisRefreshOptions) {
      if (disposed) throw new Error('analysis disposed')
      const snapshot = await store.snapshotSet(new Map(), options.inventory.revision)
      return {
        snapshot,
        universes: [],
        boundaries: [],
        results: [],
        diagnostics: [],
      }
    },
    async dispose() {
      disposed = true
      await store.dispose()
    },
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import type {
  ApplicationAnalysisRefreshOptions,
  ApplicationAnalysisWorkspace,
} from '../application/analysis/index.ts'
import { createMemoryAnalysisStore } from '../analysis/index.ts'
import { createApplicationCheckpoint } from '../application/checkpoint/index.ts'
import { createTypeSpecApplicationServiceWithDependencies } from '../application/service.ts'
import { createFileWorkspaceCheckpointStore } from '../workspace/checkpoint/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('application workspace checkpoint', () => {
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

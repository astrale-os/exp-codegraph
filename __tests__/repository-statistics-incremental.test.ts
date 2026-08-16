import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { deriveAnalysisId } from '../analysis/index.ts'
import {
  analyzeRepositoryStatistics,
  createRepositorySourceService,
  createTypeScriptSourceLineAnalyzer,
  inventoryRepository,
  type RepositoryFile,
  type RepositoryInventory,
  type RepositorySourceRead,
  type RepositorySourceService,
  type RepositoryStatisticsGrouping,
  type RepositoryStatisticsReport,
} from '../repository/index.ts'
import {
  refreshRepositoryStatistics,
} from '../repository/statistics/incremental.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('incremental repository statistics', () => {
  it('reuses an unchanged inventory without reading sources and equals cold analysis', async () => {
    const current = await fixture({
      'src/a.ts': 'export const a = true\n',
      'src/b.ts': '// b\nexport const b = true\n',
    })
    fixtures.push(current)
    const inventory = await makeInventory(current, 'unchanged')
    const previous = await cold(inventory, current.root)
    const counted = countingSource(current.root, inventory)

    const refreshed = await refreshRepositoryStatistics({
      inventory,
      sources: counted.service,
      previous,
    })
    const expected = await cold(inventory, current.root)

    expect(refreshed.report).toEqual(expected)
    expect(counted.reads).toBe(0)
    expect(refreshed.work).toEqual({
      reusedFiles: ['src/a.ts', 'src/b.ts'],
      analyzedFiles: [],
      removedFiles: [],
    })
  })

  it('reads exactly one changed file and equals cold analysis', async () => {
    const current = await fixture({
      'src/a.ts': 'export const a = true\n',
      'src/b.ts': 'export const b = true\n',
    })
    fixtures.push(current)
    const before = await makeInventory(current, 'changed-before')
    const previous = await cold(before, current.root)
    await current.write('src/b.ts', 'export const b = false\n// changed\n')
    const after = await makeInventory(current, 'changed-before')
    const counted = countingSource(current.root, after)

    const refreshed = await refreshRepositoryStatistics({
      inventory: after,
      sources: counted.service,
      previous,
    })
    const expected = await cold(after, current.root)

    expect(refreshed.report).toEqual(expected)
    expect(counted.reads).toBe(1)
    expect(refreshed.work).toEqual({
      reusedFiles: ['src/a.ts'],
      analyzedFiles: ['src/b.ts'],
      removedFiles: [],
    })
  })

  it('handles additions and deletions while retaining unchanged metrics', async () => {
    const current = await fixture({
      'src/a.ts': 'export const a = true\n',
      'src/removed.ts': 'export const removed = true\n',
    })
    fixtures.push(current)
    const before = await makeInventory(current, 'add-delete-before')
    const previous = await cold(before, current.root)
    await rm(join(current.root, 'src/removed.ts'))
    await current.write('src/added.ts', 'export const added = true\n')
    const after = await makeInventory(current, 'add-delete-before')
    const counted = countingSource(current.root, after)

    const refreshed = await refreshRepositoryStatistics({
      inventory: after,
      sources: counted.service,
      previous,
    })
    const expected = await cold(after, current.root)

    expect(refreshed.report).toEqual(expected)
    expect(counted.reads).toBe(1)
    expect(refreshed.work).toEqual({
      reusedFiles: ['src/a.ts'],
      analyzedFiles: ['src/added.ts'],
      removedFiles: ['src/removed.ts'],
    })
  })

  it('invalidates files when the applicable analyzer version changes', async () => {
    const current = await fixture({ 'src/a.ts': 'export const a = true\n' })
    fixtures.push(current)
    const inventory = await makeInventory(current, 'analyzer-version')
    const analyzerV1 = { ...createTypeScriptSourceLineAnalyzer(), version: 'test-v1' }
    const analyzerV2 = { ...createTypeScriptSourceLineAnalyzer(), version: 'test-v2' }
    const previous = await cold(inventory, current.root, [analyzerV1])
    const counted = countingSource(current.root, inventory)

    const refreshed = await refreshRepositoryStatistics({
      inventory,
      sources: counted.service,
      analyzers: [analyzerV2],
      previous,
    })
    const expected = await cold(inventory, current.root, [analyzerV2])

    expect(refreshed.report).toEqual(expected)
    expect(counted.reads).toBe(1)
    expect(refreshed.work).toEqual({
      reusedFiles: [],
      analyzedFiles: ['src/a.ts'],
      removedFiles: [],
    })
  })

  it.each(['stale', 'unavailable'] as const)(
    'preserves exact %s issue and completeness semantics',
    async (status) => {
      const current = await fixture({
        'src/a.ts': 'export const a = true\n',
        'src/b.ts': 'export const b = true\n',
      })
      fixtures.push(current)
      const before = await makeInventory(current, `failure-${status}-before`)
      const previous = await cold(before, current.root)
      await current.write('src/b.ts', 'export const b = false\n')
      const after = await makeInventory(current, `failure-${status}-before`)
      const changed = after.files.find((file) => file.path === 'src/b.ts')!
      const service = forcedReadService(current.root, after, changed, status)
      const counted = countingService(service)

      const refreshed = await refreshRepositoryStatistics({
        inventory: after,
        sources: counted.service,
        previous,
      })
      const expected = await analyzeRepositoryStatistics({ inventory: after, sources: service })

      expect(refreshed.report).toEqual(expected)
      expect(counted.reads).toBe(1)
      expect(refreshed.report.issues).toHaveLength(1)
      expect(refreshed.report.completeness.kind).toBe('partial')
    },
  )

  it('recomputes arbitrary grouping summaries from the complete metric set', async () => {
    const current = await fixture({
      'packages/core/a.ts': 'export const a = true\n',
      'packages/other/b.ts': 'export const b = true\n',
    })
    fixtures.push(current)
    const before = await makeInventory(current, 'grouping-before')
    const grouping = moduleGrouping()
    const previous = await cold(before, current.root, undefined, [grouping])
    await current.write('packages/core/a.ts', 'export const a = false\n// changed\n')
    const after = await makeInventory(current, 'grouping-before')
    const counted = countingSource(current.root, after)

    const refreshed = await refreshRepositoryStatistics({
      inventory: after,
      sources: counted.service,
      groupings: [grouping],
      previous,
    })
    const expected = await cold(after, current.root, undefined, [grouping])

    expect(refreshed.report).toEqual(expected)
    expect(refreshed.report.groups).toEqual(expected.groups)
    expect(counted.reads).toBe(1)
  })

  it('honors abort signals before reusing any file', async () => {
    const current = await fixture({ 'src/a.ts': 'export const a = true\n' })
    fixtures.push(current)
    const inventory = await makeInventory(current, 'abort')
    const previous = await cold(inventory, current.root)
    const controller = new AbortController()
    controller.abort()

    await expect(
      refreshRepositoryStatistics({
        inventory,
        sources: countingSource(current.root, inventory).service,
        previous,
        signal: controller.signal,
      }),
    ).rejects.toThrow()
  })
})

async function makeInventory(fixture: Fixture, name: string): Promise<RepositoryInventory> {
  return inventoryRepository({
    repository: deriveAnalysisId('repository', 'statistics-incremental-test', { name }),
    root: fixture.root,
  })
}

async function cold(
  inventory: RepositoryInventory,
  root: string,
  analyzers?: Parameters<typeof analyzeRepositoryStatistics>[0]['analyzers'],
  groupings?: readonly RepositoryStatisticsGrouping[],
): Promise<RepositoryStatisticsReport> {
  return analyzeRepositoryStatistics({
    inventory,
    sources: createRepositorySourceService(root, inventory),
    ...(analyzers ? { analyzers } : {}),
    ...(groupings ? { groupings } : {}),
  })
}

function countingSource(root: string, inventory: RepositoryInventory): CountingSource {
  return countingService(createRepositorySourceService(root, inventory))
}

interface CountingSource {
  readonly service: RepositorySourceService
  readonly reads: number
}

function countingService(service: RepositorySourceService): CountingSource {
  let reads = 0
  return {
    get reads() {
      return reads
    },
    service: {
      inventory: service.inventory,
      async read(request) {
        reads += 1
        return service.read(request)
      },
    },
  }
}

function forcedReadService(
  root: string,
  inventory: RepositoryInventory,
  changed: RepositoryFile,
  status: 'stale' | 'unavailable',
): RepositorySourceService {
  const base = createRepositorySourceService(root, inventory)
  return {
    inventory: inventory.revision,
    async read(request): Promise<RepositorySourceRead> {
      if ('source' in request && request.source === changed.source) {
        return status === 'stale'
          ? {
              status,
              inventory: inventory.revision,
              source: changed.source,
              expected: changed.revision,
              actual: changed.revision,
              path: changed.path,
            }
          : {
              status,
              inventory: inventory.revision,
              source: changed.source,
              reason: 'unreadable',
              path: changed.path,
              message: 'fixture unavailable',
            }
      }
      return base.read(request)
    },
  }
}

function moduleGrouping(): RepositoryStatisticsGrouping {
  return {
    id: 'module',
    values: (file) => [{ key: file.path.startsWith('packages/core/') ? 'core' : 'other' }],
  }
}

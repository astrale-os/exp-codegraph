import { afterEach, describe, expect, it } from 'vitest'

import { deriveAnalysisId } from '../analysis/index.ts'
import {
  analyzeRepositoryStatistics,
  createRepositoryPathOwnershipGrouping,
  createRepositorySourceService,
  inventoryRepository,
  typeScriptSourceLines,
  type RepositoryStatisticsGrouping,
} from '../repository/index.ts'
import ts from 'typescript'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('headless repository statistics', () => {
  it('classifies TypeScript physical lines through language tokens', () => {
    const source = ts.createSourceFile(
      'sample.ts',
      '/** docs\n * continue\n */\nconst value = 1 // trailing\n\n// note\n',
      ts.ScriptTarget.Latest,
      true,
    )

    expect(typeScriptSourceLines(source)).toEqual({
      physical: 6,
      code: 1,
      comment: 4,
      blank: 1,
      unclassified: 0,
    })
  })

  it('aggregates complete immutable facts across orthogonal and custom dimensions', async () => {
    const current = await fixture({
      'packages/core/src/index.ts':
        '/** core */\nexport const value = 1 // retained as code\n\n',
      'packages/core/__tests__/index.test.ts': 'expect(true).toBe(true)\n',
      'README.md': '# Repository\n\nDocumentation\n',
    })
    fixtures.push(current)
    const inventory = await inventoryRepository({
      repository: deriveAnalysisId('repository', 'statistics-test', { name: 'fixture' }),
      root: current.root,
    })
    const moduleGrouping: RepositoryStatisticsGrouping = {
      id: 'module',
      values: (file) => [
        { key: file.path.startsWith('packages/core/') ? 'core' : 'repository' },
      ],
    }

    const report = await analyzeRepositoryStatistics({
      inventory,
      sources: createRepositorySourceService(current.root, inventory),
      groupings: [moduleGrouping],
    })

    expect(report.completeness).toEqual({ kind: 'complete' })
    expect(report.issues).toEqual([])
    expect(report.summary).toMatchObject({
      files: 3,
      lines: { physical: 7, code: 2, comment: 1, blank: 2, unclassified: 2 },
    })
    expect(report.groups.map((group) => [group.key, group.summary.files])).toEqual([
      ['core', 2],
      ['repository', 1],
    ])
    expect(report.files.find((file) => file.path === 'README.md')).toMatchObject({
      lineAnalyzer: { id: 'astrale.repository.lines.text' },
      lines: { physical: 3, blank: 1, unclassified: 2 },
    })
  })

  it('reports a stale pinned source instead of mixing generations or returning a zero as fact', async () => {
    const current = await fixture({
      'src/first.ts': 'export const first = true\n',
      'src/second.ts': 'export const second = true\n',
    })
    fixtures.push(current)
    const inventory = await inventoryRepository({
      repository: deriveAnalysisId('repository', 'statistics-test', { name: 'stale' }),
      root: current.root,
    })
    await current.write('src/second.ts', 'export const second = false\n')

    const report = await analyzeRepositoryStatistics({
      inventory,
      sources: createRepositorySourceService(current.root, inventory),
    })

    expect(report.completeness).toMatchObject({ kind: 'partial' })
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'REPOSITORY_STATISTICS_SOURCE_STALE',
        path: 'src/second.ts',
      }),
    ])
    expect(report.files.find((file) => file.path === 'src/second.ts')?.completeness).toMatchObject({
      kind: 'unavailable',
    })
    expect(report.summary.lines.code).toBe(1)
  })

  it('retains binary files and infers only root workspace package ownership', async () => {
    const current = await fixture({
      'README.md': '# repository\n',
      'asset.bin': new Uint8Array([0xff, 0xfe, 0x00]),
      'packages/core/src/index.ts': 'export const core = true\n',
      'packages/@scope/tool/src/index.ts': 'export const tool = true\n',
      '.spec/packages/msgpackr.ts': 'export interface Msgpackr {}\n',
    })
    fixtures.push(current)
    const inventory = await inventoryRepository({
      repository: deriveAnalysisId('repository', 'statistics-test', { name: 'ownership' }),
      root: current.root,
    })

    const readme = inventory.files.find((file) => file.path === 'README.md')
    expect(readme).toMatchObject({
      content: 'text',
      language: 'markdown',
    })
    expect(readme).not.toHaveProperty('area')
    expect(readme).not.toHaveProperty('package')
    const binary = inventory.files.find((file) => file.path === 'asset.bin')
    expect(binary).toMatchObject({
      content: 'binary',
      language: 'binary',
    })
    expect(binary).not.toHaveProperty('area')
    expect(binary).not.toHaveProperty('package')
    expect(inventory.files.find((file) => file.path === 'packages/core/src/index.ts')).toMatchObject({
      area: 'packages',
      package: 'core',
    })
    expect(
      inventory.files.find((file) => file.path === 'packages/@scope/tool/src/index.ts'),
    ).toMatchObject({ area: 'packages', package: '@scope/tool' })
    const declaredPackage = inventory.files.find(
      (file) => file.path === '.spec/packages/msgpackr.ts',
    )
    expect(declaredPackage).toMatchObject({
      area: '.spec',
    })
    expect(declaredPackage).not.toHaveProperty('package')

    const report = await analyzeRepositoryStatistics({
      inventory,
      sources: createRepositorySourceService(current.root, inventory),
    })

    expect(report.completeness).toEqual({ kind: 'complete' })
    expect(report.issues).toEqual([])
    expect(report.files.find((file) => file.path === 'asset.bin')).toMatchObject({
      lineAnalyzer: { id: 'astrale.repository.lines.not-applicable', version: '1' },
      lines: { physical: 0, code: 0, comment: 0, blank: 0, unclassified: 0 },
      completeness: { kind: 'complete' },
    })
    expect(
      report.groups
        .filter((group) => group.dimension === 'package')
        .map((group) => group.key),
    ).toEqual(['@scope/tool', 'core', 'unassigned'])
  })

  it('verifies original UTF-8 bytes and reads governed evidence larger than the edit limit', async () => {
    const large = 'x'.repeat(5 * 1024 * 1024 + 1)
    const current = await fixture({
      'evidence/large.json': large,
      'src/bom.ts': new Uint8Array([
        0xef, 0xbb, 0xbf,
        ...new TextEncoder().encode('export const value = true\n'),
      ]),
    })
    fixtures.push(current)
    const inventory = await inventoryRepository({
      repository: deriveAnalysisId('repository', 'statistics-test', { name: 'large' }),
      root: current.root,
    })

    const report = await analyzeRepositoryStatistics({
      inventory,
      sources: createRepositorySourceService(current.root, inventory),
    })

    expect(report.completeness).toEqual({ kind: 'complete' })
    expect(report.issues).toEqual([])
    expect(report.files.find((file) => file.path === 'evidence/large.json')?.lines).toMatchObject({
      physical: 1,
      unclassified: 1,
    })
    expect(report.files.find((file) => file.path === 'src/bom.ts')).toMatchObject({
      completeness: { kind: 'complete' },
      lines: { code: 1 },
    })
  })

  it('assigns nested path ownership to the deepest declared module root', async () => {
    const current = await fixture({
      'core/index.ts': 'export const core = true\n',
      'core/child/index.ts': 'export const child = true\n',
      'outside.ts': 'export const outside = true\n',
    })
    fixtures.push(current)
    const inventory = await inventoryRepository({
      repository: deriveAnalysisId('repository', 'statistics-test', { name: 'modules' }),
      root: current.root,
    })
    const grouping = createRepositoryPathOwnershipGrouping('module', [
      { root: '.', key: 'root', label: 'Root' },
      { root: 'core', key: 'core' },
      { root: 'core/child', key: 'child', label: 'Child' },
    ])

    const report = await analyzeRepositoryStatistics({
      inventory,
      sources: createRepositorySourceService(current.root, inventory),
      groupings: [grouping],
    })

    expect(
      report.groups.map((group) => [group.key, group.label, group.summary.files]),
    ).toEqual([
      ['child', 'Child', 1],
      ['core', 'core', 1],
      ['root', 'Root', 1],
    ])
    expect(() =>
      createRepositoryPathOwnershipGrouping('module', [
        { root: 'core', key: 'first' },
        { root: './core/', key: 'second' },
      ]),
    ).toThrow('ownership root is ambiguous')
  })
})

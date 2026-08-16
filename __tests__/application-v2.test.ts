import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'

import type {
  ApplicationAnalysisRefreshOptions,
  ApplicationAnalysisWorkspace,
} from '../application/analysis/index.ts'
import type { AnalysisTelemetryEvent } from '../analysis/index.ts'

import { createMemoryAnalysisStore, deriveAnalysisId } from '../analysis/index.ts'
import { createTypeSpecApplicationServiceWithDependencies } from '../application/service.ts'
import { validateApplicationModuleBoundaries } from '../application/analysis/index.ts'
import {
  APPLICATION_LAYOUT_FACT_NAMESPACE,
  APPLICATION_TEST_FACT_NAMESPACE,
  materializeApplicationObservations,
} from '../application/observation/index.ts'
import {
  createModuleLayoutConformanceProfile,
  createModuleSchemaConformanceProfile,
  createModuleTestEvidenceConformanceProfile,
  createSpecificationValidityConformanceProfile,
  qualifySpecification,
} from '../conformance/index.ts'
import { inventoryRepository } from '../repository/index.ts'
import { compileSpecificationSnapshot } from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('headless TypeSpec V2 application', () => {
  it('reports diagnostic-only lifecycle phases around the actual headless work', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/application-progress', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    fixtures.push(current)
    const events: AnalysisTelemetryEvent[] = []
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root, telemetry: (event) => events.push(event) },
      { analysis: emptyAnalysisWorkspace(), profiles: [] },
    )

    try {
      await service.refresh({ qualify: true })
    } finally {
      await service.dispose()
    }

    const lifecycle = events
      .filter((event) => event.phase.startsWith('application.'))
      .map((event) => [event.phase, event.metrics?.status])
    expect(lifecycle).toEqual([
      ['application.inventory', 'started'],
      ['application.inventory', 'completed'],
      ['application.discovery', 'started'],
      ['application.discovery', 'completed'],
      ['application.compile', 'started'],
      ['application.compile', 'completed'],
      ['application.statistics', 'started'],
      ['application.statistics', 'completed'],
      ['application.analysis', 'started'],
      ['application.analysis', 'completed'],
      ['application.qualification', 'started'],
      ['application.qualification', 'completed'],
    ])
    expect(events.filter((event) => event.durationNs !== undefined).length).toBe(6)
  })

  it('rejects ambiguous implementation roots and entrypoints without repository exceptions', () => {
    const common = {
      project: 'tsconfig.json',
      root: 'src/shared',
      entrypoint: 'src/shared/index.ts',
      facades: [],
      aliases: [],
      internals: [],
    }
    const resolved = validateApplicationModuleBoundaries([
      { id: 'first/.spec/api.d.ts', name: 'first', ...common },
      { id: 'second/.spec/api.d.ts', name: 'second', ...common },
    ])

    expect(resolved.boundaries).toEqual([])
    expect(resolved.diagnostics).toHaveLength(4)
    expect(new Set(resolved.diagnostics.map((entry) => entry.code))).toEqual(
      new Set(['APPLICATION_CODE_TARGET_AMBIGUOUS']),
    )
  })

  it('composes immutable normative and qualification snapshots without presentation authority', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/application-v2', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    fixtures.push(current)
    const analysis = emptyAnalysisWorkspace()
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis,
        profiles: [createSpecificationValidityConformanceProfile()],
      },
    )

    try {
      const firstRefresh = await service.refresh({ qualify: true })
      const secondRefresh = await service.refresh({ qualify: true })
      const first = firstRefresh.snapshot
      const second = secondRefresh.snapshot

      expect(first.id).toBe(second.id)
      expect(first.specifications).toHaveLength(1)
      expect(first.qualifications).toHaveLength(1)
      expect(first.qualifications[0]?.status).toBe('pass')
      expect(first.repository).toMatch(/^repository:/u)
      expect(first.analysis?.universes).toEqual([])
      expect(first.inventory).toBe(first.analysis?.inventory)
      expect(service.current()).toBe(first)
      expect(secondRefresh.changes.previous).toBe(first.id)
      expect(secondRefresh.timing.totalMs).toBeGreaterThanOrEqual(0)
      expect(secondRefresh.timing.compileMs).toBe(0)
      expect(secondRefresh.timing.statisticsMs).toBe(0)
      expect(secondRefresh.timing.analysisMs).toBe(0)
      expect(secondRefresh.timing.qualificationMs).toBe(0)
      expect(secondRefresh.timing.inventoryMs).toBeGreaterThanOrEqual(0)
      expect(Object.isFrozen(first)).toBe(true)
      expect(Object.isFrozen(first.specifications[0])).toBe(true)
      expect('catalog' in first).toBe(false)
      expect('verification' in first.specifications[0]!).toBe(false)
      const reader = await service.open(first.id)
      const source = await reader.source({ path: 'module/.spec/api.d.ts' })
      expect(source).toMatchObject({ status: 'current', path: 'module/.spec/api.d.ts' })
      await current.write(
        'module/.spec/api.d.ts',
        'export interface Value { readonly id: string; readonly changed: true }\n',
      )
      expect(await reader.source({ path: 'module/.spec/api.d.ts' })).toMatchObject({
        status: 'stale',
        path: 'module/.spec/api.d.ts',
      })
      const changedRefresh = await service.refresh({ qualify: true })
      expect(changedRefresh.snapshot.id).not.toBe(first.id)
      expect(changedRefresh.changes.specifications.changed).toEqual(['module/.spec/api.d.ts'])
      await reader.dispose()
    } finally {
      await service.dispose()
    }
    await expect(service.refresh()).rejects.toThrow('disposed')
  })

  it('keeps application identity portable across equivalent checkout roots', async () => {
    const files = {
      'package.json': JSON.stringify({ name: '@fixture/portable-application', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    }
    const left = await fixture(files)
    const right = await fixture(files)
    fixtures.push(left, right)
    const leftService = await createTypeSpecApplicationServiceWithDependencies(
      { root: left.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [] },
    )
    const rightService = await createTypeSpecApplicationServiceWithDependencies(
      { root: right.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [] },
    )

    try {
      const leftSnapshot = (await leftService.refresh()).snapshot
      const rightSnapshot = (await rightService.refresh()).snapshot
      expect(leftSnapshot.id).toBe(rightSnapshot.id)
      expect(leftSnapshot.repository).toBe(rightSnapshot.repository)
      expect(JSON.stringify(leftSnapshot)).not.toContain(left.root)
      expect(JSON.stringify(rightSnapshot)).not.toContain(right.root)
    } finally {
      await Promise.all([leftService.dispose(), rightService.dispose()])
    }
  })

  it('recompiles only normative owners affected by an explicit dev change set', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/incremental-corpus', type: 'module' }),
      'shared/types.d.ts': 'export interface Shared { readonly value: string }\n',
      'alpha/.spec/api.d.ts': `import type { Shared } from '../../shared/types.js'
export interface Alpha { readonly value: Shared }
`,
      'alpha/src/index.ts': 'export const alpha = true\n',
      'beta/.spec/api.d.ts': 'export interface Beta { readonly value: string }\n',
    })
    fixtures.push(current)
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [] },
    )
    try {
      const first = (await service.refresh()).snapshot
      const before = new Map(first.specifications.map((value) => [value.source, value]))

      await current.write('alpha/src/index.ts', 'export const alpha = false\n')
      const implementation = (
        await service.refresh({ changed: [join(current.root, 'alpha/src/index.ts')] })
      ).snapshot
      expect(implementation.specifications[0]).toBe(before.get('alpha/.spec/api.d.ts'))
      expect(implementation.specifications[1]).toBe(before.get('beta/.spec/api.d.ts'))

      await current.write(
        'alpha/.spec/api.d.ts',
        `import type { Shared } from '../../shared/types.js'
export interface Alpha { readonly value: Shared; readonly changed: true }
`,
      )
      const normative = (
        await service.refresh({ changed: [join(current.root, 'alpha/.spec/api.d.ts')] })
      ).snapshot
      expect(normative.specifications[0]).not.toBe(before.get('alpha/.spec/api.d.ts'))
      expect(normative.specifications[1]).not.toBe(before.get('beta/.spec/api.d.ts'))

      const afterNormative = new Map(
        normative.specifications.map((value) => [value.source, value]),
      )
      await current.write(
        'shared/types.d.ts',
        'export interface Shared { readonly value: number }\n',
      )
      const shared = (
        await service.refresh({ changed: [join(current.root, 'shared/types.d.ts')] })
      ).snapshot
      expect(shared.specifications[0]).not.toBe(afterNormative.get('alpha/.spec/api.d.ts'))
      expect(shared.specifications[1]).not.toBe(afterNormative.get('beta/.spec/api.d.ts'))
    } finally {
      await service.dispose()
    }
  })

  it('expands focused owners through support and optional dependent closures', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/application-selection', type: 'module' }),
      'base/.spec/api.d.ts': 'export interface Base { readonly id: string }\n',
      'consumer/.spec/api.d.ts': `import type { Base } from '../../base/.spec/api.js'
export interface Consumer { readonly base: Base }
`,
    })
    fixtures.push(current)
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [] },
    )
    try {
      const consumer = (
        await service.refresh({ focused: true, select: ['consumer'] })
      ).snapshot
      expect(consumer.selection).toMatchObject({
        kind: 'focused',
        authority: 'advisory',
        selected: ['consumer/.spec/api.d.ts'],
        support: ['base/.spec/api.d.ts'],
      })
      expect(consumer.specifications.map((value) => value.source)).toEqual([
        'base/.spec/api.d.ts',
        'consumer/.spec/api.d.ts',
      ])

      const baseRefresh = await service.refresh({
        focused: true,
        select: ['base'],
        includeDependents: true,
      })
      const base = baseRefresh.snapshot
      expect(baseRefresh.timing.discoverMs).toBe(0)
      expect(baseRefresh.timing.compileMs).toBe(0)
      expect(baseRefresh.timing.statisticsMs).toBe(0)
      expect(base.selection).toMatchObject({
        selected: ['base/.spec/api.d.ts', 'consumer/.spec/api.d.ts'],
        support: [],
        includeDependents: true,
      })
    } finally {
      await service.dispose()
    }
  })

  it('materializes layout and resolved test evidence as repository-scoped facts', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/application-observation', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
      'module/.spec/layout.ts': `import { defineLayout } from '@astrale-os/codegraph/authoring'
export default defineLayout({ entries: ['src/', 'src/index.ts'], exact: true })
`,
      // The previous package spelling remains an input alias while consumers migrate to Codegraph.
      'module/.spec/laws/value.ts': `import { defineLaw } from '@astrale-os/spec/authoring'
export const VALUE_PRESENT = defineLaw({ id: 'VALUE-PRESENT', statement: 'A value is present.', tests: [{ file: 'tests/value.test.ts', id: 'VALUE-PRESENT' }] })
`,
      'module/src/index.ts': 'export const value = true\n',
      'module/tests/value.test.ts': `/** @evidence VALUE-PRESENT */
it('keeps the value', () => {})
`,
    })
    fixtures.push(current)
    const repository = deriveAnalysisId('repository', 'fixture.application-observation', {})
    const inventory = await inventoryRepository({ repository, root: current.root })
    const specification = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'module/.spec'),
    )
    const store = createMemoryAnalysisStore()
    try {
      const observed = await materializeApplicationObservations({
        root: current.root,
        store,
        inventory,
        specifications: [specification],
      })
      const snapshot = await store.snapshotSet(
        new Map([[observed.universe, observed.generation.id]]),
        inventory.revision,
      )
      try {
        const qualification = await qualifySpecification({
          specification,
          analysis: snapshot,
          profiles: [
            createSpecificationValidityConformanceProfile(),
            createModuleLayoutConformanceProfile({ requireComplete: true, requireExact: true }),
            createModuleSchemaConformanceProfile(),
            createModuleTestEvidenceConformanceProfile(),
          ],
        })
        expect(qualification.status).toBe('pass')
        const query = await snapshot.query(observed.universe)
        try {
          const layout = await query.facts({ namespaces: [APPLICATION_LAYOUT_FACT_NAMESPACE] }, { limit: 10 })
          const tests = await query.facts({ namespaces: [APPLICATION_TEST_FACT_NAMESPACE] }, { limit: 10 })
          expect(layout.facts).toHaveLength(1)
          expect(layout.facts[0]?.payload).toMatchObject({
            declared: true,
            entries: [
              { path: 'src/', status: 'matched' },
              { path: 'src/index.ts', status: 'matched' },
            ],
            diagnostics: [],
          })
          expect(tests.facts).toHaveLength(1)
          expect(tests.facts[0]?.payload).toMatchObject({
            laws: [{ id: 'VALUE-PRESENT', evidence: [{ status: 'active' }] }],
            diagnostics: [],
          })
        } finally {
          await query.dispose()
        }
      } finally {
        await snapshot.dispose()
      }
    } finally {
      await store.dispose()
    }
  })
})

function emptyAnalysisWorkspace(): ApplicationAnalysisWorkspace {
  const store = createMemoryAnalysisStore()
  let disposed = false
  return {
    async refresh(options: ApplicationAnalysisRefreshOptions) {
      if (disposed) throw new Error('analysis disposed')
      const snapshot = await store.snapshotSet(
        new Map(),
        options.inventory.revision,
      )
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

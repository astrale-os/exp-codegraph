import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'

import type {
  ApplicationAnalysisRefreshOptions,
  ApplicationAnalysisWorkspace,
} from '../application/analysis/index.ts'
import type { ConformanceProfile } from '../conformance/index.ts'
import { createMemoryAnalysisStore } from '../analysis/index.ts'
import { createTypeSpecApplicationServiceWithDependencies } from '../application/service.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('application qualification deltas', () => {
  it('re-evaluates only affected specification-local profiles and equals a cold result', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/qualification-delta', type: 'module' }),
      'alpha/.spec/api.d.ts': 'export interface Alpha { readonly id: string }\n',
      'alpha/src/index.ts': 'export const alpha = true\n',
      'beta/.spec/api.d.ts': 'export interface Beta { readonly id: string }\n',
    })
    fixtures.push(current)
    const evaluated: string[] = []
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      {
        analysis: emptyAnalysisWorkspace(),
        profiles: [localProfile(evaluated)],
      },
    )
    try {
      await service.refresh({ qualify: true })
      expect(evaluated).toEqual(['alpha/.spec/api.d.ts', 'beta/.spec/api.d.ts'])

      await current.write('alpha/src/index.ts', 'export const alpha = false\n')
      const incremental = await service.refresh({
        qualify: true,
        changed: [join(current.root, 'alpha/src/index.ts')],
      })
      expect(evaluated).toEqual([
        'alpha/.spec/api.d.ts',
        'beta/.spec/api.d.ts',
        'alpha/.spec/api.d.ts',
      ])

      const cold = await createTypeSpecApplicationServiceWithDependencies(
        { root: current.root },
        { analysis: emptyAnalysisWorkspace(), profiles: [localProfile([])] },
      )
      try {
        const rebuilt = await cold.refresh({ qualify: true })
        expect(incremental.snapshot.qualifications).toEqual(rebuilt.snapshot.qualifications)
      } finally {
        await cold.dispose()
      }
    } finally {
      await service.dispose()
    }
  })

  it('never carries a universe-scoped or undeclared custom profile across generations', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/qualification-global', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
      'docs/readme.md': 'before\n',
    })
    fixtures.push(current)
    const evaluated: string[] = []
    const base = localProfile(evaluated)
    const profile: ConformanceProfile = {
      ...base,
      manifest: { ...base.manifest, evaluationScope: 'universe' },
    }
    const service = await createTypeSpecApplicationServiceWithDependencies(
      { root: current.root },
      { analysis: emptyAnalysisWorkspace(), profiles: [profile] },
    )
    try {
      await service.refresh({ qualify: true })
      await current.write('docs/readme.md', 'after\n')
      await service.refresh({
        qualify: true,
        changed: [join(current.root, 'docs/readme.md')],
      })
      expect(evaluated).toEqual(['module/.spec/api.d.ts', 'module/.spec/api.d.ts'])
    } finally {
      await service.dispose()
    }
  })
})

function localProfile(evaluated: string[]): ConformanceProfile {
  return {
    manifest: {
      id: 'fixture.specification-local',
      version: '1.0.0',
      dependsOn: [],
      requiresCapabilities: [],
      rules: ['LOCAL-PASS'],
      evaluationScope: 'specification',
    },
    async evaluate({ specification }) {
      evaluated.push(specification.source)
      return [
        {
          rule: 'LOCAL-PASS',
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
}

function emptyAnalysisWorkspace(): ApplicationAnalysisWorkspace {
  const store = createMemoryAnalysisStore()
  return {
    open: (generations, inventory) => store.snapshotSet(generations, inventory),
    async refresh(options: ApplicationAnalysisRefreshOptions) {
      const snapshot = await store.snapshotSet(new Map(), options.inventory.revision)
      return {
        snapshot,
        universes: [],
        boundaries: [],
        results: [],
        diagnostics: [],
      }
    },
    dispose: () => store.dispose(),
  }
}

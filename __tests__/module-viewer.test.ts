import { afterEach, describe, expect, it } from 'vitest'

import { createCatalogSnapshot } from '../server/catalog-snapshot.ts'
import { projectApplicationCatalog } from '../server/application-catalog.ts'
import { createTypeSpecApplicationService } from '../application/index.ts'
import { historyResourceUrl } from '../viewer/history/view.tsx'
import { layoutTreeRows } from '../viewer/specification/layout.tsx'
import { stateMermaid } from '../viewer/specification/module-resources.tsx'
import {
  moduleSourceReferenceTarget,
  resourceTitle,
} from '../viewer/specification/module-source-navigation.ts'
import { defaultSpecTab, specTabGroups } from '../viewer/specification/tabs.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('module specification viewer projection', () => {
  it('derives Mermaid state topology without inventing terminal transitions', () => {
    const diagram = stateMermaid({
      exportName: 'jobState',
      initial: 'pending',
      transitions: {
        pending: { start: 'execution-started' },
        'execution-started': { complete: 'completed' },
        completed: {},
      },
      testEvidence: [],
    })

    expect(diagram).toContain('stateDiagram-v2')
    expect(diagram).toContain('state "execution-started" as S1')
    expect(diagram).toContain('[*] --> S0')
    expect(diagram).toContain('S0 --> S1: start')
    expect(diagram).toContain('S1 --> S2: complete')
    expect(diagram).not.toContain('S2 --> [*]')
  })

  it('presents resource filenames as readable section names', () => {
    expect(resourceTitle('module/.spec/capabilities/invocation-observation.ts')).toBe(
      'Invocation Observation',
    )
    expect(resourceTitle('module/.spec/schemas/edge-slug.schema.json')).toBe('Edge Slug')
  })

  it('projects matched, missing, mismatched, and additional paths into one compact tree', () => {
    const rows = layoutTreeRows({
      ref: './layout.ts',
      source: 'module/.spec/layout.ts',
      text: '',
      revision: 'layout',
      entries: [
        { path: 'src/', kind: 'directory' },
        { path: 'src/missing.ts', kind: 'file' },
        { path: 'src/backend/', kind: 'directory' },
      ],
      observation: {
        entries: [
          { path: 'src/', status: 'matched', observedKind: 'directory' },
          { path: 'src/missing.ts', status: 'missing' },
          { path: 'src/backend/', status: 'mismatch', observedKind: 'file' },
        ],
        additional: [{ path: 'src/extra.ts', kind: 'file' }],
        revision: 'observation',
      },
      exact: true,
      ignore: [],
    })

    expect(rows.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: 'src/', status: 'matched' },
      { path: 'src/missing.ts', status: 'missing' },
      { path: 'src/backend/', status: 'mismatch' },
      { path: 'src/extra.ts', status: 'additional' },
    ])
    expect(rows[1]?.prefix).toBe('   ├─ ')
    expect(rows.at(-1)?.prefix).toBe('   └─ ')
  })

  it('presents undeclared sparse-map paths as neutral observations', () => {
    const rows = layoutTreeRows({
      ref: './layout.ts',
      source: 'module/.spec/layout.ts',
      text: '',
      revision: 'layout',
      entries: [{ path: 'src/', kind: 'directory' }],
      exact: false,
      ignore: [{ pattern: '**/*.test.*', source: 'default' }],
      observation: {
        entries: [{ path: 'src/', status: 'matched', observedKind: 'directory' }],
        additional: [{ path: 'src/extra.ts', kind: 'file' }],
        revision: 'observation',
      },
    })

    expect(rows.at(-1)).toMatchObject({ path: 'src/extra.ts', status: 'observed' })
  })

  it('projects every populated module dimension and searchable semantics', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/internal.d.ts': 'export interface Internal {}\n',
      'module/.spec/capabilities/query.ts':
        "import { defineCapability } from '@astrale-os/codegraph/authoring'\nexport const QRY_EXECUTE = defineCapability({ id: 'QRY-EXECUTE', statement: 'Queries can execute.' })\n",
      'module/.spec/flows/query.ts':
        "import { jobState } from '../states/job.js'\nexport function query(): void { void jobState }\n",
      'module/.spec/laws/query.ts':
        "import { defineLaw } from '@astrale-os/codegraph/authoring'\nexport const QRY_RESULT_SOUND = defineLaw({ id: 'QRY-RESULT-SOUND', statement: 'Query results are sound.' })\n",
      'module/.spec/states/job.ts':
        "import { defineState } from '@astrale-os/codegraph/authoring'\nexport const jobState = defineState({ transitions: { ready: {} } })\n",
      'module/.spec/limits.ts': 'export const limits = { max: 1 } as const\n',
      'module/.spec/layout.ts':
        "import { defineLayout } from '@astrale-os/codegraph/authoring'\nexport default defineLayout(['src/', 'src/value.ts'])\n",
      'module/src/value.ts': 'export {}\n',
      'module/.spec/benchmarks/query.ts':
        "import { defineBenchmark } from '@astrale-os/codegraph/authoring'\nexport const QRY_EXECUTE_SCALE = defineBenchmark({ id: 'QRY-EXECUTE-SCALE', statement: 'Measures query execution.', workload: 'Execute one query.', metrics: ['duration'] })\n",
      'module/.spec/architecture.md': '# Architecture\n',
      'module/.history/notes.md': '# Notes\n',
      'module/.history/report.pdf': '%PDF-context',
    })
    fixtures.push(current)
    const service = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'fixture:module-viewer-v2',
    })
    const refresh = await service.refresh({ qualify: true, compilerAnalysis: false })
    const reader = await service.open(refresh.snapshot.id)
    const catalog = await projectApplicationCatalog(current.root, reader)
    await reader.dispose()
    await service.dispose()
    const spec = catalog.specs[0]!

    const tabs = specTabGroups(spec)
    const snapshot = createCatalogSnapshot({ specs: [spec], diagnostics: [] }, {})
    const entry = snapshot.index.specs[0]
    const context = spec.history.find((resource) => resource.presentation === 'pdf')!

    expect(tabs.primary).toEqual([
      'architecture',
      'api',
      'capabilities',
      'flows',
      'laws',
      'states',
      'limits',
      'layout',
      'internal',
      'benchmarks',
    ])
    expect(defaultSpecTab(spec)).toBe('architecture')
    expect(tabs.secondary).toContain('history')
    expect(tabs.secondary).not.toContain('manifest')
    expect(entry?.searchText).toContain('QRY-RESULT-SOUND')
    expect(entry?.searchText).toContain('Query results are sound.')
    expect(entry?.searchText).toContain('src/value.ts')
    expect(historyResourceUrl(context)).toContain(encodeURIComponent(context.source))
    const packed = snapshot.specs.values().next().value?.spec
    expect(packed?.history).toHaveLength(2)
    expect(spec.internal?.model).toBeDefined()
    expect(packed?.internal).not.toHaveProperty('model')
    expect(layoutTreeRows(spec.layout!)).toEqual([
      expect.objectContaining({ path: 'src/', status: 'matched', prefix: '', level: 1 }),
      expect.objectContaining({
        path: 'src/value.ts',
        status: 'matched',
        prefix: '   └─ ',
        level: 2,
      }),
    ])

    const stateReference = spec.sourceReferences.find(
      (reference) =>
        reference.source === 'module/.spec/flows/query.ts' &&
        reference.target.source === 'module/.spec/states/job.ts',
    )
    expect(stateReference).toBeDefined()
    expect(moduleSourceReferenceTarget(spec, stateReference!)?.href).toContain('tab=states')
    expect(moduleSourceReferenceTarget(spec, stateReference!)?.href).toContain(
      'resource=module%2F.spec%2Fstates%2Fjob.ts',
    )
  })
})

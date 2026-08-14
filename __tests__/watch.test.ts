import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { TypeSpecApplicationSnapshot } from '../application/index.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'

import { createRebuildScheduler } from '../server/reload.ts'
import { DEV_SERVER_WATCH_IGNORES, isWatchedSource } from '../server/watch.ts'

describe('live universal resource watching', () => {
  it('watches every explicit local resource, transitive declaration, and artifact schema', () => {
    const root = '/workspace'
    const snapshot = applicationSnapshot(resourceSpecification())
    const watched = [
      'module/.spec/api.d.ts',
      'shared/types.d.ts',
      'module/.spec/port.d.ts',
      'module/.spec/value.schema.json',
      'module/.spec/examples/value.ts',
      'module/.spec/capabilities/read.ts',
      'module/.spec/flows/read.ts',
      'module/.spec/laws/read.ts',
      'module/.spec/states/session.ts',
      'module/.spec/limits.ts',
      'module/.spec/layout.ts',
      'module/src/index.ts',
      'module/tsconfig.json',
    ]

    for (const source of watched) {
      expect(isWatchedSource(snapshot, root, join(root, source)), source).toBe(true)
    }
    expect(isWatchedSource(snapshot, root, join(root, 'unlisted.md'))).toBe(false)
    expect(isWatchedSource(snapshot, root, join(root, 'node_modules/external/types.d.ts'))).toBe(
      false,
    )
    expect(isWatchedSource(snapshot, root, '/outside/types.d.ts')).toBe(false)
  })

  it('coalesces save bursts and performs one trailing rebuild for changes during work', async () => {
    let releaseFirst!: () => void
    let markStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => (markStarted = resolve))
    const firstBlocked = new Promise<void>((resolve) => (releaseFirst = resolve))
    const rebuild = vi.fn(async () => {
      const generation = rebuild.mock.calls.length
      if (generation === 1) {
        markStarted()
        await firstBlocked
      }
      return { catalog: { specs: [], diagnostics: [] }, changed: true, generation }
    })
    const scheduler = createRebuildScheduler(rebuild, 0)

    const first = scheduler.request()
    const sameBurst = scheduler.request()
    await firstStarted
    const trailing = scheduler.request()
    releaseFirst()

    const results = await Promise.all([first, sameBurst, trailing])
    expect(rebuild).toHaveBeenCalledTimes(2)
    expect(results.every((result) => result.generation === 2)).toBe(true)
  })

  it('watches convention-profile topology, context, package intent, and not-yet-bound source', () => {
    const root = '/workspace'
    const snapshot = applicationSnapshot(moduleSpecification())

    for (const source of [
      'module/.spec/laws/new.ts',
      'module/.history/research.pdf',
      'module/package.json',
      'module/tsconfig.json',
    ]) {
      expect(isWatchedSource(snapshot, root, join(root, source)), source).toBe(true)
    }
    for (const source of ['module/src/index.ts', 'module/src/new.ts', 'module/lib/new.ts']) {
      expect(isWatchedSource(snapshot, root, join(root, source), 'add'), source).toBe(true)
    }
    expect(isWatchedSource(snapshot, root, join(root, 'module/.spec/invalid.log'))).toBe(false)
    expect(isWatchedSource(snapshot, root, join(root, 'module/.history/tool.log'), 'add')).toBe(false)
    expect(isWatchedSource(undefined, root, join(root, 'new/.spec/api.d.ts'))).toBe(true)
  })

  it('rejects generated output while retaining exact and potential project sources', () => {
    const root = '/workspace'
    const snapshot = applicationSnapshot(resourceSpecification())

    expect(isWatchedSource(snapshot, root, join(root, 'module/src/index.ts'), 'change')).toBe(true)
    expect(isWatchedSource(snapshot, root, join(root, 'module/src/new.ts'), 'add')).toBe(true)
    expect(isWatchedSource(snapshot, root, join(root, 'module/src/new.ts'), 'change')).toBe(true)
    expect(isWatchedSource(snapshot, root, join(root, 'module/src/build.log'), 'add')).toBe(false)
    expect(isWatchedSource(snapshot, root, join(root, 'module/dist/index.js'), 'add')).toBe(false)
    expect(isWatchedSource(snapshot, root, join(root, 'module/cache.tsbuildinfo'), 'add')).toBe(
      false,
    )
    expect(
      isWatchedSource(
        applicationSnapshot(resourceSpecification('.')),
        root,
        join(root, 'new-area/source.ts'),
        'add',
      ),
    ).toBe(true)
    expect(DEV_SERVER_WATCH_IGNORES).not.toContain('**/*.log')
    expect(DEV_SERVER_WATCH_IGNORES).toContain('**/dist/**')
  })

  it('rechecks declared layout paths only when their topology changes', () => {
    const root = '/workspace'
    const snapshot = applicationSnapshot(moduleSpecification())
    const dockerfile = join(root, 'module/Dockerfile')

    expect(isWatchedSource(snapshot, root, dockerfile, 'change')).toBe(false)
    expect(isWatchedSource(snapshot, root, dockerfile, 'add')).toBe(true)
    expect(isWatchedSource(snapshot, root, dockerfile, 'unlink')).toBe(true)
  })

  it('waits for the latest edit in a burst before starting an expensive rebuild', async () => {
    vi.useFakeTimers()
    try {
      const rebuild = vi.fn(async () => ({
        catalog: { specs: [], diagnostics: [] },
        changed: true,
        generation: 1,
      }))
      const scheduler = createRebuildScheduler(rebuild, 80)

      const result = scheduler.request()
      await vi.advanceTimersByTimeAsync(60)
      scheduler.request()
      await vi.advanceTimersByTimeAsync(79)
      expect(rebuild).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(21)
      await result
      expect(rebuild).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

function moduleSpecification(): SpecificationSnapshot {
  return {
    format: 'astrale.typespec.specification',
    version: 2,
    id: 'specification:module',
    revision: 'spec',
    title: 'Module',
    source: 'module/.spec/api.d.ts',
    root: 'module',
    module: {
      id: 'module/.spec/api.d.ts',
      name: 'Module',
      declarationPointer: '',
      ports: [],
      packages: [],
      packageAuthority: { source: 'module/.spec/api.d.ts', packages: [], packagePatterns: [] },
    },
    schemas: [],
    examples: [],
    capabilities: [],
    flows: [],
    laws: [],
    states: [],
    layout: {
      ref: './layout.ts',
      source: 'module/.spec/layout.ts',
      text: '',
      revision: 'layout',
      entries: [
        { path: 'Dockerfile', kind: 'file' },
        { path: 'lib/', kind: 'directory' },
      ],
      exact: false,
      ignore: [],
    },
    benchmarks: [],
    packages: [],
    packagePatterns: [],
    sourceReferences: [],
    diagnostics: [],
  }
}

function resourceSpecification(root = 'module'): SpecificationSnapshot {
  const resource = (source: string) => ({
    ref: `./${source.split('/').at(-1)}`,
    source,
    text: '',
    revision: source,
  })
  const base = moduleSpecification()
  return {
    ...base,
    root,
    module: {
      ...base.module,
      api: {
        ...resource('module/.spec/api.d.ts'),
        model: { sources: [{ file: 'shared/types.d.ts', revision: 'shared', text: '' }] } as never,
      },
      ports: [
        {
          ...resource('module/.spec/port.d.ts'),
          declarationPointer: '/ports/0',
          port: { name: 'Port', declaration: 'port' },
        },
      ],
      code: { ...resource('module/src/index.ts'), internals: [] },
    },
    schemas: [{ ...resource('module/.spec/value.schema.json'), schema: {} }],
    examples: [
      { ...resource('module/.spec/examples/value.ts'), against: 'api', declarationPointer: '' },
    ],
    capabilities: [
      { ...resource('module/.spec/capabilities/read.ts'), kind: 'capability', definitions: [] },
    ],
    flows: [{ ...resource('module/.spec/flows/read.ts'), kind: 'flow' }],
    laws: [{ ...resource('module/.spec/laws/read.ts'), kind: 'law', definitions: [] }],
    states: [{ ...resource('module/.spec/states/session.ts'), kind: 'state', definitions: [] }],
    limits: { ...resource('module/.spec/limits.ts'), kind: 'limits' },
  }
}

function applicationSnapshot(specification: SpecificationSnapshot): TypeSpecApplicationSnapshot {
  return {
    format: 'astrale.typespec.application',
    version: 2,
    id: 'application:test',
    repository: 'repository:test',
    inventory: 'manifest:test',
    selection: { kind: 'full', authority: 'full-ci' },
    specifications: [specification],
    qualifications: [],
    diagnostics: [],
    analysisDiagnostics: [],
  }
}

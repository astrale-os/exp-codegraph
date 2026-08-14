import { describe, expect, it, vi } from 'vitest'

import type { ApiBatchCompiler, ApiCompiler } from '../compiler/contract.ts'

import { createCachedApiCompiler } from '../compiler/cache.ts'
import { createCoalescingApiCompiler } from '../compiler/coalesce.ts'

describe('API compiler cache', () => {
  it('coalesces implicit and explicit authored V2 semantics into one cache identity', async () => {
    const compiler: ApiCompiler = {
      compile: vi.fn(async (request) => ({
        ok: true,
        diagnostics: [],
        dependencies: [{ file: 'api.d.ts', revision: 'current' }],
        api: undefined,
      })),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async () => 'current',
      revision: (text) => text,
    })
    const request = { mainFile: '/workspace/api.d.ts', projectRoot: '/workspace' }

    await cached.compile(request)
    await cached.compile({ ...request, semantics: 'specification-v2' })
    await cached.compile(request)
    await cached.compile({ ...request, semantics: 'specification-v2' })

    expect(compiler.compile).toHaveBeenCalledOnce()
  })

  it('reuses only dependency-current compilations', async () => {
    const files = new Map([['/workspace/api.d.ts', 'revision-one']])
    const compiler: ApiCompiler = {
      compile: vi.fn(async () => ({
        ok: true,
        diagnostics: [],
        dependencies: [{ file: 'api.d.ts', revision: files.get('/workspace/api.d.ts')! }],
      })),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async (file) => files.get(file)!,
      revision: (text) => text,
    })
    const request = { mainFile: '/workspace/api.d.ts', projectRoot: '/workspace' }

    await cached.compile(request)
    await cached.compile(request)
    expect(compiler.compile).toHaveBeenCalledTimes(1)

    files.set('/workspace/api.d.ts', 'revision-two')
    await cached.compile(request)
    expect(compiler.compile).toHaveBeenCalledTimes(2)
  })

  it('does not share an in-flight result across coherent revision snapshots', async () => {
    const files = new Map([['/workspace/api.d.ts', 'revision-one']])
    const releases: Array<() => void> = []
    const compiler: ApiCompiler = {
      compile: vi.fn(() => {
        const revision = files.get('/workspace/api.d.ts')!
        return new Promise((resolve) => {
          releases.push(() =>
            resolve({
              ok: true,
              diagnostics: [],
              dependencies: [{ file: 'api.d.ts', revision }],
            }),
          )
        })
      }),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async (file) => files.get(file)!,
      revision: (text) => text,
    })
    const request = { mainFile: '/workspace/api.d.ts', projectRoot: '/workspace' }

    const first = cached.withRevisionSnapshot(() => cached.compile(request))
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledOnce())
    files.set('/workspace/api.d.ts', 'revision-two')
    const second = cached.withRevisionSnapshot(() => cached.compile(request))
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledTimes(2))

    releases[0]!()
    releases[1]!()
    await expect(first).resolves.toMatchObject({
      dependencies: [{ revision: 'revision-one' }],
    })
    await expect(second).resolves.toMatchObject({
      dependencies: [{ revision: 'revision-two' }],
    })
  })

  it('does not share an in-flight result between unsnapshotted rebuilds', async () => {
    const files = new Map([['/workspace/api.d.ts', 'revision-one']])
    const releases: Array<() => void> = []
    const compiler: ApiCompiler = {
      compile: vi.fn(() => {
        const revision = files.get('/workspace/api.d.ts')!
        return new Promise((resolve) => {
          releases.push(() =>
            resolve({
              ok: true,
              diagnostics: [],
              dependencies: [{ file: 'api.d.ts', revision }],
            }),
          )
        })
      }),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async (file) => files.get(file)!,
      revision: (text) => text,
    })
    const request = { mainFile: '/workspace/api.d.ts', projectRoot: '/workspace' }

    const first = cached.compile(request)
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledOnce())
    files.set('/workspace/api.d.ts', 'revision-two')
    const second = cached.compile(request)
    await vi.waitFor(() => expect(compiler.compile).toHaveBeenCalledTimes(2))

    releases[0]!()
    releases[1]!()
    await expect(first).resolves.toMatchObject({ dependencies: [{ revision: 'revision-one' }] })
    await expect(second).resolves.toMatchObject({ dependencies: [{ revision: 'revision-two' }] })
  })

  it('evicts the least recently used compilation at an explicit small capacity', async () => {
    const compiler: ApiCompiler = {
      compile: vi.fn(async (request) => ({
        ok: true,
        diagnostics: [],
        dependencies: [{ file: request.mainFile, revision: request.mainFile }],
      })),
    }
    const cached = createCachedApiCompiler(
      compiler,
      { read: async (file) => file, revision: (text) => text },
      { capacity: 2 },
    )
    const request = (name: string) => ({
      mainFile: `/workspace/${name}.d.ts`,
      projectRoot: '/workspace',
    })

    await cached.compile(request('a'))
    await cached.compile(request('b'))
    await cached.compile(request('a'))
    await cached.compile(request('c'))
    await cached.compile(request('a'))
    await cached.compile(request('b'))

    expect(compiler.compile).toHaveBeenCalledTimes(4)
  })

  it('does not retain failures whose dependency closure is uncertain', async () => {
    const compiler: ApiCompiler = {
      compile: vi.fn(async () => ({
        ok: false,
        diagnostics: [
          {
            source: 'typescript' as const,
            code: 'TS2307',
            severity: 'error' as const,
            message: 'Missing module.',
          },
        ],
        dependencies: [{ file: 'api.d.ts', revision: 'revision' }],
      })),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async () => 'revision',
      revision: (text) => text,
    })
    const request = { mainFile: '/workspace/api.d.ts', projectRoot: '/workspace' }

    await cached.compile(request)
    await cached.compile(request)
    expect(compiler.compile).toHaveBeenCalledTimes(2)
  })

  it('retains one catalog-sized declaration wave without traversal-order thrashing', async () => {
    const compiler: ApiCompiler = {
      compile: vi.fn(async (request) => ({
        ok: true,
        diagnostics: [],
        dependencies: [{ file: request.mainFile, revision: request.mainFile }],
      })),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async (file) => file,
      revision: (text) => text,
    })
    const requests = Array.from({ length: 256 }, (_, index) => ({
      mainFile: `/workspace/${index}.d.ts`,
      projectRoot: '/workspace',
    }))

    await Promise.all(requests.map((request) => cached.compile(request)))
    await Promise.all(requests.map((request) => cached.compile(request)))

    expect(compiler.compile).toHaveBeenCalledTimes(requests.length)
  })

  it('interns identical immutable source and token evidence across cached APIs', async () => {
    const compiler: ApiCompiler = {
      compile: vi.fn(async (request) => ({
        ok: true,
        diagnostics: [],
        dependencies: [{ file: request.mainFile, revision: 'revision' }],
        api: {
          format: 'astrale.api' as const,
          version: 2 as const,
          entrypoint: request.mainFile,
          fingerprint: request.mainFile,
          sourceRevision: 'revision',
          sources: [{ file: 'shared.d.ts', revision: 'revision', text: 'export type A = 1' }],
          surface: { exports: [], declarations: [], issues: [] },
          metadata: {},
          tokens: [{ file: 'shared.d.ts', from: 12, to: 13, text: 'A' }],
        },
      })),
    }
    const cached = createCachedApiCompiler(compiler, {
      read: async () => 'revision',
      revision: (text) => text,
    })

    const first = await cached.compile({
      mainFile: '/workspace/one.d.ts',
      projectRoot: '/workspace',
    })
    const second = await cached.compile({
      mainFile: '/workspace/two.d.ts',
      projectRoot: '/workspace',
    })

    expect(second.api?.sources[0]).toBe(first.api?.sources[0])
    expect(second.api?.tokens[0]).toBe(first.api?.tokens[0])
  })

  it('reads one shared dependency once within each coherent revision snapshot', async () => {
    const shared = new Map([['/workspace/shared.d.ts', 'one']])
    const compiler: ApiCompiler = {
      compile: vi.fn(async () => ({
        ok: true,
        diagnostics: [],
        dependencies: [{ file: 'shared.d.ts', revision: shared.get('/workspace/shared.d.ts')! }],
      })),
    }
    const read = vi.fn(async (file: string) => shared.get(file)!)
    const cached = createCachedApiCompiler(compiler, { read, revision: (text) => text })
    const requests = ['/workspace/one.d.ts', '/workspace/two.d.ts'].map((mainFile) => ({
      mainFile,
      projectRoot: '/workspace',
    }))

    await Promise.all(requests.map((request) => cached.compile(request)))
    await cached.withRevisionSnapshot(async () => {
      await cached.compile(requests[0]!)
      await cached.compile(requests[1]!)
    })
    expect(read).toHaveBeenCalledOnce()

    shared.set('/workspace/shared.d.ts', 'two')
    await cached.withRevisionSnapshot(async () => {
      await Promise.all(requests.map((request) => cached.compile(request)))
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(compiler.compile).toHaveBeenCalledTimes(4)
  })

  it('restores scoped evidence and still invalidates changed dependencies', async () => {
    const files = new Map([['/workspace/api.d.ts', 'one']])
    const dependencies = {
      read: async (file: string) => files.get(file)!,
      revision: (text: string) => text,
    }
    const result = async () => ({
      ok: true as const,
      diagnostics: [],
      dependencies: [{ file: 'api.d.ts', revision: files.get('/workspace/api.d.ts')! }],
    })
    const first = createCachedApiCompiler({ compile: vi.fn(result) }, dependencies)
    const request = { mainFile: '/workspace/api.d.ts', projectRoot: '/workspace' }
    await first.compile(request)

    const restoredCompile = vi.fn(result)
    const restored = createCachedApiCompiler({ compile: restoredCompile }, dependencies)
    restored.restore('/workspace', structuredClone(first.snapshot('/workspace')))
    await restored.compile(request)
    expect(restoredCompile).not.toHaveBeenCalled()

    files.set('/workspace/api.d.ts', 'two')
    await restored.compile(request)
    expect(restoredCompile).toHaveBeenCalledOnce()
  })

  it('coalesces one scheduled request wave without changing the caller contract', async () => {
    const schedules: Array<() => void> = []
    const batch: ApiBatchCompiler = {
      compileMany: vi.fn(async (requests) =>
        requests.map((request) => ({
          ok: true as const,
          diagnostics: [],
          dependencies: [{ file: request.mainFile, revision: 'current' }],
        })),
      ),
    }
    const compiler = createCoalescingApiCompiler(batch, {
      schedule: (flush) => schedules.push(flush),
    })

    const first = compiler.compile({ mainFile: '/one.d.ts' })
    const second = compiler.compile({ mainFile: '/two.d.ts' })
    expect(schedules).toHaveLength(1)
    schedules[0]!()

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ dependencies: [{ file: '/one.d.ts', revision: 'current' }] }),
      expect.objectContaining({ dependencies: [{ file: '/two.d.ts', revision: 'current' }] }),
    ])
    expect(batch.compileMany).toHaveBeenCalledTimes(1)
    expect(batch.compileMany).toHaveBeenCalledWith([
      { mainFile: '/one.d.ts' },
      { mainFile: '/two.d.ts' },
    ])
  })
})

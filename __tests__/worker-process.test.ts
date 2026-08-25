import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationModuleBindingRequest } from '../analysis/index.ts'

import { compileApplicationModuleBindingsIsolated } from '../compiler/application-binding-process.optimization.ts'
import { compileApisInIsolatedWorker } from '../compiler/isolation-process.optimization.ts'
import { codegraphWorkerProcess } from '../compiler/worker-process.ts'

const workerSpawns = vi.hoisted(() => [] as unknown[][])
const fixtures: string[] = []

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (...arguments_: unknown[]) => {
      workerSpawns.push(arguments_)
      return Reflect.apply(actual.spawn, actual, arguments_)
    },
  }
})

afterEach(async () => {
  workerSpawns.length = 0
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('compiler worker process identity', () => {
  it('retains the heap bound, stable role, and worker-specific arguments', () => {
    expect(
      codegraphWorkerProcess(
        'application-binding',
        '/codegraph/application-binding.js',
        512,
        ['--codegraph-binding-worker'],
      ),
    ).toEqual({
      executable: process.execPath,
      arguments: [
        '--max-old-space-size=512',
        '/codegraph/application-binding.js',
        '--codegraph-worker=application-binding',
        '--codegraph-binding-worker',
      ],
    })
  })

  it('passes distinct stable roles through the real API and binding spawn owners', async () => {
    const root = await project()
    const api = join(root, 'module', '.spec', 'api.d.ts')
    const apiResult = await compileApisInIsolatedWorker([{ mainFile: api, projectRoot: root }], {})
    expect(apiResult[0]?.ok).toBe(true)

    const binding = await compileApplicationModuleBindingsIsolated({
      root,
      requests: [bindingRequest()],
    })
    expect(binding.facts[0]?.diagnostics).toEqual([])

    expect(workerSpawns.map(([, arguments_]) => arguments_)).toEqual([
      [
        expect.stringMatching(/^--max-old-space-size=/u),
        expect.stringMatching(/worker\.ts$/u),
        '--codegraph-worker=api-compiler',
      ],
      [
        expect.stringMatching(/^--max-old-space-size=/u),
        expect.stringMatching(/application-binding-process\.optimization\.ts$/u),
        '--codegraph-worker=application-binding',
        '--codegraph-binding-worker',
      ],
    ])
  })
})

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-worker-process-'))
  fixtures.push(root)
  await mkdir(join(root, 'module', '.spec'), { recursive: true })
  await Promise.all([
    writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
        },
      }),
      'utf8',
    ),
    writeFile(
      join(root, 'module', '.spec', 'api.d.ts'),
      "export declare const version: 'v1'\n",
      'utf8',
    ),
    writeFile(
      join(root, 'module', 'index.ts'),
      "export const version = 'v1' as const\n",
      'utf8',
    ),
    writeFile(
      join(root, 'module', 'implementation.contract.ts'),
      "import type * as contract from './.spec/api.js'\nimport * as implementation from './index.js'\nimplementation satisfies typeof contract\n",
      'utf8',
    ),
  ])
  return root
}

function bindingRequest(): ApplicationModuleBindingRequest {
  return {
    specification: 'specification:fixture',
    source: 'module/.spec/api.d.ts',
    target: {
      id: 'fixture',
      name: 'fixture',
      project: 'tsconfig.json',
      root: 'module',
      entrypoint: 'module/index.ts',
      facades: [],
      aliases: [],
      internals: [],
    },
  }
}

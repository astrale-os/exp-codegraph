import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { CliServices } from '../cli/run.ts'

import { changedSpecificationScope } from '../cli/changes.ts'
import { changedLawImpact } from '../cli/impact.ts'
import { parseCommand } from '../cli/parse.ts'
import { runCommand } from '../cli/run.ts'
import { fixture, type Fixture } from './fixture.ts'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')
const exec = promisify(execFile)
const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

const AUTHORING = "import { defineCapability, defineLaw } from '@astrale-os/codegraph/authoring'\n"

const CATALOG: Record<string, string> = {
  'package.json': JSON.stringify({ name: '@fixture/law-impact', type: 'module' }),
  '.spec/api.d.ts': 'export {}\n',
  '.spec/capabilities/kernel.ts': `${AUTHORING}export const KERNEL_BOOTS = defineCapability({
  id: 'KERNEL-BOOTS',
  statement: 'The kernel boots.',
  capabilities: [{ module: 'runtime', id: 'RUNTIME-STARTS' }],
})
export const KERNEL_NAMED = defineCapability({
  id: 'KERNEL-NAMED',
  statement: 'The kernel has a name.',
  laws: [{ module: 'runtime', id: 'RUNTIME-UNTOUCHED' }],
})
`,
  'runtime/.spec/api.d.ts': 'export {}\n',
  'runtime/.spec/capabilities/runtime.ts': `${AUTHORING}export const RUNTIME_STARTS = defineCapability({
  id: 'RUNTIME-STARTS',
  statement: 'The runtime starts.',
  laws: ['RUNTIME-ANCHORED', { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' }],
})
`,
  'runtime/.spec/laws/runtime.ts': `${AUTHORING}export const RUNTIME_ANCHORED = defineLaw({
  id: 'RUNTIME-ANCHORED',
  statement: 'The runtime order is anchored in code.',
  code: [{ file: 'src/order.ts', symbol: 'order' }, { file: 'boot/src/journal.sql' }],
})
export const RUNTIME_UNTOUCHED = defineLaw({
  id: 'RUNTIME-UNTOUCHED',
  statement: 'A law whose evidence does not change.',
  tests: [{ file: '__tests__/untouched.test.ts', id: 'RUNTIME-UNTOUCHED' }],
})
`,
  'runtime/src/order.ts': 'export const order = 1\n',
  'runtime/src/other.ts': 'export const other = 1\n',
  'runtime/__tests__/untouched.test.ts':
    "/** @evidence RUNTIME-UNTOUCHED */\nit('stays', () => {})\n",
  'runtime/boot/.spec/api.d.ts': 'export {}\n',
  'runtime/boot/.spec/laws/boot.ts': `${AUTHORING}export const BOOT_INPUT_BEFORE_DURABLE = defineLaw({
  id: 'BOOT-INPUT-BEFORE-DURABLE',
  statement: 'Input is admitted before durable state.',
  tests: [{ file: '__tests__/boot.test.ts', id: 'BOOT-INPUT-BEFORE-DURABLE' }],
})
`,
  'runtime/boot/__tests__/boot.test.ts':
    "/** @evidence BOOT-INPUT-BEFORE-DURABLE */\nit('admits input first', () => {})\n",
  'runtime/boot/src/journal.sql': 'create table journal (id text primary key);\n',
  'query/.spec/api.d.ts': 'export {}\n',
  'query/src/plan.ts': 'export const plan = 1\n',
  'query/src/cost.ts': 'export const cost = 1\n',
  'query/src/notes.md': 'Notes.\n',
  'query/__tests__/plan.test.ts': "it('plans', () => {})\n",
  'idle/.spec/api.d.ts': 'export {}\n',
  'idle/__tests__/idle.test.ts': "it('idles', () => {})\n",
}

describe('changed law impact', { timeout: 30_000 }, () => {
  /** @evidence CLI-CHANGED-IMPACT-INFORMATIONAL */
  it('lists touched laws, their citing capabilities, and law-less changed modules', async () => {
    const current = await repository(CATALOG)
    await current.write(
      'runtime/boot/__tests__/boot.test.ts',
      "/** @evidence BOOT-INPUT-BEFORE-DURABLE */\nit('always admits input first', () => {})\n",
    )
    await current.write('runtime/src/order.ts', 'export const order = 2\n')
    await current.write('runtime/src/other.ts', 'export const other = 2\n')
    await current.write('runtime/boot/src/journal.sql', 'create table journal (id text);\n')
    await current.write('query/src/plan.ts', 'export const plan = 2\n')
    await current.write('query/src/cost.ts', 'export const cost = 2\n')
    await current.write('query/src/notes.md', 'More notes.\n')
    await current.write('query/__tests__/plan.test.ts', "it('plans again', () => {})\n")
    await current.write('query/.spec/api.d.ts', 'export interface Query {}\n')
    await current.write('idle/__tests__/idle.test.ts', "it('still idles', () => {})\n")

    const scope = await changedSpecificationScope(current.root, 'HEAD')
    expect(await changedLawImpact(current.root, scope.files)).toEqual({
      laws: [
        {
          module: 'runtime',
          id: 'RUNTIME-ANCHORED',
          source: 'runtime/.spec/laws/runtime.ts',
          reasons: [
            { kind: 'code', file: 'runtime/src/order.ts' },
            { kind: 'code', file: 'runtime/boot/src/journal.sql' },
          ],
        },
        {
          module: 'runtime/boot',
          id: 'BOOT-INPUT-BEFORE-DURABLE',
          source: 'runtime/boot/.spec/laws/boot.ts',
          reasons: [{ kind: 'test', file: 'runtime/boot/__tests__/boot.test.ts' }],
        },
      ],
      capabilities: [
        {
          module: 'runtime',
          id: 'RUNTIME-STARTS',
          source: 'runtime/.spec/capabilities/runtime.ts',
          cites: {
            laws: [
              { module: 'runtime', id: 'RUNTIME-ANCHORED' },
              { module: 'runtime/boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
            ],
            capabilities: [],
          },
        },
        {
          // Reached only through another capability, and listed after the direct citer.
          module: '.',
          id: 'KERNEL-BOOTS',
          source: '.spec/capabilities/kernel.ts',
          cites: { laws: [], capabilities: [{ module: 'runtime', id: 'RUNTIME-STARTS' }] },
        },
      ],
      // Only source files count: tests, documentation, and .spec material do not.
      lawless: [{ module: 'query', files: ['query/src/cost.ts', 'query/src/plan.ts'] }],
    })

    const section = [
      'Impact: 2 laws, 2 capabilities, 1 module without a law.',
      '  law runtime#RUNTIME-ANCHORED: code runtime/src/order.ts changed, code runtime/boot/src/journal.sql changed',
      '  law runtime/boot#BOOT-INPUT-BEFORE-DURABLE: test runtime/boot/__tests__/boot.test.ts changed',
      '  capability runtime#RUNTIME-STARTS: cites law runtime#RUNTIME-ANCHORED, law runtime/boot#BOOT-INPUT-BEFORE-DURABLE',
      '  capability .#KERNEL-BOOTS: cites capability runtime#RUNTIME-STARTS',
      '  module query: no law, 2 changed source files (query/src/cost.ts, +1 more)',
    ]
    const scoped = await run(['changed', current.root, 'HEAD', '--scope-only'])
    expect(scoped).toEqual({
      code: 0,
      stdout: ['Changed scope against HEAD: 10 files, 4 changed modules.', ...section, ''].join('\n'),
      stderr: '',
    })

    const checked = await run(['changed', current.root, 'HEAD', '--quiet', '--no-cache'])
    expect(checked).toEqual({
      code: 0,
      stdout: [
        'Changed scope against HEAD: 10 files, 4 changed modules.',
        ...section,
        'Capabilities: 0 declared, 2 partial, 1 held.',
        'Checked affected closure: 5 specifications (5 changed + 0 support), 0 diagnostics.',
        '',
      ].join('\n'),
      stderr: '',
    })
  })

  it('prints the section when the scope falls back to the full catalog and keeps the exit status', async () => {
    const current = await repository(CATALOG)
    await current.write('runtime/src/order.ts', 'export const renamed = 2\n')
    await current.write(
      'package.json',
      JSON.stringify({ name: '@fixture/law-impact', type: 'module', private: true }),
    )

    const result = await run(['changed', current.root, 'HEAD', '--quiet', '--no-cache'])
    expect(result.stdout).toBe(
      [
        'Changed scope against HEAD: 2 files, full catalog.',
        'Impact: 1 law, 2 capabilities, 0 modules without a law.',
        '  law runtime#RUNTIME-ANCHORED: code runtime/src/order.ts changed',
        '  capability runtime#RUNTIME-STARTS: cites law runtime#RUNTIME-ANCHORED',
        '  capability .#KERNEL-BOOTS: cites capability runtime#RUNTIME-STARTS',
        'Capabilities: 0 declared, 2 partial, 1 held.',
        'Checked full catalog: 5 specifications, 1 diagnostic.',
        '',
      ].join('\n'),
    )
    // The failure is the unresolved anchor found by the check, never the impact section.
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('[CODE_ANCHOR_SYMBOL_MISSING]')
  })

  it('resolves changed files against a catalog root below the workspace root', async () => {
    const current = await repository(
      Object.fromEntries(
        Object.entries(CATALOG).map(([path, text]) => [`packages/kernel/${path}`, text]),
      ),
    )
    await current.write('packages/kernel/runtime/src/order.ts', 'export const order = 2\n')
    await current.write('outside.ts', 'export const outside = 1\n')

    const root = join(current.root, 'packages/kernel')
    const scope = await changedSpecificationScope(root, 'HEAD')
    expect(scope.files).toEqual(['outside.ts', 'packages/kernel/runtime/src/order.ts'])
    expect(await changedLawImpact(root, scope.files)).toMatchObject({
      laws: [{ module: 'runtime', id: 'RUNTIME-ANCHORED' }],
      lawless: [],
    })
  })

  it('adds nothing when no changed file belongs to the catalog', async () => {
    const current = await repository(
      Object.fromEntries(
        Object.entries(CATALOG).map(([path, text]) => [`packages/kernel/${path}`, text]),
      ),
    )
    await current.write('outside.ts', 'export const outside = 1\n')

    expect(
      await run(['changed', join(current.root, 'packages/kernel'), 'HEAD', '--scope-only']),
    ).toEqual({
      code: 0,
      stdout: 'No specification-affecting changes found against HEAD.\n',
      stderr: '',
    })
  })

  it('reports an empty impact in one line', async () => {
    const current = await repository(CATALOG)
    await current.write('idle/__tests__/idle.test.ts', "it('still idles', () => {})\n")
    await current.write('runtime/__tests__/unattached.test.ts', "it('is new', () => {})\n")

    expect(await run(['changed', current.root, 'HEAD', '--scope-only'])).toEqual({
      code: 0,
      stdout: [
        'Changed scope against HEAD: 2 files, 2 changed modules.',
        'Impact: 0 laws, 0 capabilities, 0 modules without a law.',
        '',
      ].join('\n'),
      stderr: '',
    })
  })

  it('never lets an impact failure change the command outcome', async () => {
    const lines: string[] = []
    const services = {
      changedSpecificationScope: async () => ({
        kind: 'selected' as const,
        base: 'HEAD',
        files: ['module/index.ts'],
        targets: ['module'],
      }),
      changedLawImpact: async () => {
        throw new Error('descriptor catalog unreadable')
      },
    } as unknown as CliServices

    const result = await runCommand(
      parseCommand(['changed', '.', 'HEAD', '--scope-only'], {}),
      services,
      { out: (message) => lines.push(message), error: (message) => lines.push(message) },
    )

    expect(result).toEqual({ exitCode: 0 })
    expect(lines).toEqual([
      'Changed scope against HEAD: 1 file, 1 changed module.',
      'Impact unavailable: descriptor catalog unreadable',
    ])
  })
})

async function repository(files: Record<string, string>): Promise<Fixture> {
  const current = await fixture(files)
  fixtures.push(current)
  await exec('git', ['-C', current.root, 'init', '-q'])
  await exec('git', ['-C', current.root, 'add', '.'])
  await exec('git', [
    '-C',
    current.root,
    '-c',
    'user.name=Spec Test',
    '-c',
    'user.email=spec@example.test',
    'commit',
    '-qm',
    'fixture',
  ])
  return current
}

async function run(arguments_: readonly string[]): Promise<{
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}> {
  try {
    const result = await exec(process.execPath, [cli, ...arguments_], {
      cwd: dirname(cli),
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      timeout: 30_000,
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const result = error as {
      readonly code?: number
      readonly stdout?: string
      readonly stderr?: string
    }
    return {
      code: typeof result.code === 'number' ? result.code : 2,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  }
}

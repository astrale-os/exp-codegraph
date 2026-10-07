import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { TypeSpecApplicationRefreshOptions } from '../application/index.ts'

import { createTypeSpecApplicationService } from '../application/index.ts'
import {
  compileSpecificationSnapshot,
  deriveCapabilityStatuses,
  type CapabilityDerivationModule,
} from '../specification/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')
const exec = promisify(execFile)
const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

const AUTHORING = "import { defineCapability, defineLaw } from '@astrale-os/codegraph/authoring'\n"

function capability(id: string, fields = ''): string {
  return `export const ${id.replaceAll('-', '_')} = defineCapability({
  id: '${id}',
  statement: 'Statement of ${id}.',
${fields}})
`
}

function law(id: string, fields = ''): string {
  return `export const ${id.replaceAll('-', '_')} = defineLaw({
  id: '${id}',
  statement: 'Statement of ${id}.',
${fields}})
`
}

describe('capability derivation', { timeout: 30_000 }, () => {
  it('resolves citations inside the citing module and reports each cycle member', async () => {
    const current = await fixture({
      'runtime/.spec/api.d.ts': 'export {}\n',
      'runtime/.spec/laws/runtime.ts': AUTHORING + law('RUNTIME-ORDERED'),
      'runtime/.spec/capabilities/runtime.ts':
        AUTHORING +
        capability(
          'RUNTIME-STARTS',
          "  laws: ['RUNTIME-ORDERED', 'RUNTIME-MISSING', 'RUNTIME-READY'],\n  capabilities: ['RUNTIME-READY', 'RUNTIME-ABSENT'],\n",
        ) +
        capability('RUNTIME-READY', "  capabilities: ['RUNTIME-LOOPS'],\n") +
        capability('RUNTIME-LOOPS', "  capabilities: ['RUNTIME-READY'],\n") +
        capability('RUNTIME-SELF', "  capabilities: ['RUNTIME-SELF'],\n"),
    })
    fixtures.push(current)

    const snapshot = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'runtime/.spec'),
    )

    expect(snapshot.diagnostics).toEqual([
      {
        code: 'CAPABILITY_LAW_UNKNOWN',
        message: 'Capability RUNTIME-STARTS references undeclared law RUNTIME-MISSING.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 5,
        column: 29,
      },
      {
        // A capability is not a law: each list resolves against its own kind.
        code: 'CAPABILITY_LAW_UNKNOWN',
        message: 'Capability RUNTIME-STARTS references undeclared law RUNTIME-READY.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 5,
        column: 48,
      },
      {
        code: 'CAPABILITY_CAPABILITY_UNKNOWN',
        message: 'Capability RUNTIME-STARTS references undeclared capability RUNTIME-ABSENT.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 6,
        column: 35,
      },
      {
        code: 'CAPABILITY_CYCLE',
        message:
          'Capability RUNTIME-READY reaches itself through capabilities: RUNTIME-READY → RUNTIME-LOOPS → RUNTIME-READY.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 11,
        column: 18,
      },
      {
        code: 'CAPABILITY_CYCLE',
        message:
          'Capability RUNTIME-LOOPS reaches itself through capabilities: RUNTIME-LOOPS → RUNTIME-READY → RUNTIME-LOOPS.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 16,
        column: 18,
      },
      {
        code: 'CAPABILITY_CYCLE',
        message:
          'Capability RUNTIME-SELF reaches itself through capabilities: RUNTIME-SELF → RUNTIME-SELF.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 21,
        column: 18,
      },
    ])
  })

  /** @evidence SPECIFICATION-CAPABILITY-CITATIONS-DESCEND */
  it('resolves descendant citations against specified descendant modules only', async () => {
    const current = await fixture({
      'runtime/.spec/api.d.ts': 'export {}\n',
      'runtime/.spec/capabilities/runtime.ts':
        AUTHORING +
        capability(
          'RUNTIME-STARTS',
          `  laws: [
    { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
    { module: 'boot', id: 'BOOT-RENAMED' },
    { module: 'boot/journal', id: 'JOURNAL-REPLAYS' },
    { module: 'server', id: 'SERVER-LISTENS' },
    { module: 'unspecified', id: 'UNSPECIFIED-LAW' },
  ],
  capabilities: [
    { module: 'boot', id: 'BOOT-READY' },
    { module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' },
  ],
`,
        ),
      'runtime/boot/.spec/api.d.ts': 'export {}\n',
      'runtime/boot/.spec/laws/boot.ts': AUTHORING + law('BOOT-INPUT-BEFORE-DURABLE'),
      'runtime/boot/.spec/capabilities/boot.ts': AUTHORING + capability('BOOT-READY'),
      'runtime/boot/journal/.spec/api.d.ts': 'export {}\n',
      'runtime/boot/journal/.spec/laws/journal.ts': AUTHORING + law('JOURNAL-REPLAYS'),
      'runtime/unspecified/.spec/laws/unspecified.ts': AUTHORING + law('UNSPECIFIED-LAW'),
      // A sibling of the citing module is specified, yet it is not one of its descendants.
      'server/.spec/api.d.ts': 'export {}\n',
      'server/.spec/laws/server.ts': AUTHORING + law('SERVER-LISTENS'),
    })
    fixtures.push(current)

    const snapshot = await compileSpecificationSnapshot(
      current.root,
      join(current.root, 'runtime/.spec'),
    )

    expect(snapshot.diagnostics).toEqual([
      {
        code: 'CAPABILITY_LAW_UNKNOWN',
        message:
          'Capability RUNTIME-STARTS references undeclared law BOOT-RENAMED in module boot.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 7,
        column: 23,
      },
      {
        code: 'CAPABILITY_MODULE_UNKNOWN',
        message:
          'Capability RUNTIME-STARTS references server, which is not a specified descendant module (no .spec/api.d.ts).',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 9,
        column: 7,
      },
      {
        code: 'CAPABILITY_MODULE_UNKNOWN',
        message:
          'Capability RUNTIME-STARTS references unspecified, which is not a specified descendant module (no .spec/api.d.ts).',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 10,
        column: 7,
      },
      {
        code: 'CAPABILITY_CAPABILITY_UNKNOWN',
        message:
          'Capability RUNTIME-STARTS references undeclared capability BOOT-INPUT-BEFORE-DURABLE in module boot.',
        file: 'runtime/.spec/capabilities/runtime.ts',
        line: 14,
        column: 23,
      },
    ])
  })

  /** @evidence SPECIFICATION-CAPABILITY-STATUS-DERIVED */
  it('derives declared, held, and partial statuses through cited capabilities', () => {
    const modules: CapabilityDerivationModule[] = [
      module('.', [
        ['KERNEL-BOOTS', [{ module: 'runtime/boot', id: 'BOOT-ACTIVE' }], [
          { module: 'runtime', id: 'RUNTIME-STARTS' },
        ]],
        ['KERNEL-SERVES', [], [{ module: 'runtime', id: 'RUNTIME-PAUSED' }]],
        ['KERNEL-NAMED', [], []],
        ['KERNEL-COMPOSED', [], ['KERNEL-NAMED']],
        ['KERNEL-DANGLING', [{ module: 'runtime', id: 'RUNTIME-GONE' }], []],
        ['KERNEL-LOOPS', [], ['KERNEL-LOOPS']],
      ]),
      module(
        'runtime',
        [
          ['RUNTIME-STARTS', ['RUNTIME-LOCAL', { module: 'boot', id: 'BOOT-ACTIVE' }], []],
          ['RUNTIME-PAUSED', ['RUNTIME-LOCAL', { module: 'boot', id: 'BOOT-SKIPPED' }], []],
        ],
        { 'RUNTIME-LOCAL': true },
      ),
      module('runtime/boot', [], { 'BOOT-ACTIVE': true, 'BOOT-SKIPPED': false }),
    ]

    expect(
      deriveCapabilityStatuses(modules).map(({ module, id, status, blocking }) => ({
        capability: `${module}#${id}`,
        status,
        blocking,
      })),
    ).toEqual([
      { capability: '.#KERNEL-BOOTS', status: 'held', blocking: { laws: [], capabilities: [] } },
      {
        capability: '.#KERNEL-SERVES',
        status: 'partial',
        blocking: { laws: [], capabilities: [{ module: 'runtime', id: 'RUNTIME-PAUSED' }] },
      },
      {
        capability: '.#KERNEL-NAMED',
        status: 'declared',
        blocking: { laws: [], capabilities: [] },
      },
      {
        // A cited capability that cites nothing is declared, not held.
        capability: '.#KERNEL-COMPOSED',
        status: 'partial',
        blocking: { laws: [], capabilities: [{ module: '.', id: 'KERNEL-NAMED' }] },
      },
      {
        capability: '.#KERNEL-DANGLING',
        status: 'partial',
        blocking: { laws: [{ module: 'runtime', id: 'RUNTIME-GONE' }], capabilities: [] },
      },
      {
        capability: '.#KERNEL-LOOPS',
        status: 'partial',
        blocking: { laws: [], capabilities: [{ module: '.', id: 'KERNEL-LOOPS' }] },
      },
      {
        capability: 'runtime#RUNTIME-STARTS',
        status: 'held',
        blocking: { laws: [], capabilities: [] },
      },
      {
        capability: 'runtime#RUNTIME-PAUSED',
        status: 'partial',
        blocking: { laws: [{ module: 'runtime/boot', id: 'BOOT-SKIPPED' }], capabilities: [] },
      },
    ])
  })

  it('loads cited descendants as support and re-checks only direct citers of a change', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/capability-selection', type: 'module' }),
      '.spec/api.d.ts': 'export interface Kernel { readonly name: string }\n',
      '.spec/capabilities/kernel.ts':
        AUTHORING +
        capability('KERNEL-BOOTS', "  capabilities: [{ module: 'runtime', id: 'RUNTIME-STARTS' }],\n"),
      'runtime/.spec/api.d.ts': 'export interface Runtime { readonly name: string }\n',
      'runtime/.spec/capabilities/runtime.ts':
        AUTHORING +
        capability(
          'RUNTIME-STARTS',
          "  laws: [{ module: 'boot', id: 'BOOT-INPUT-BEFORE-DURABLE' }],\n",
        ),
      'runtime/boot/.spec/api.d.ts': 'export interface Boot { readonly name: string }\n',
      'runtime/boot/.spec/laws/boot.ts': AUTHORING + law('BOOT-INPUT-BEFORE-DURABLE'),
      // A public-contract consumer of the citing module is not a consumer of the cited one.
      'console/.spec/api.d.ts':
        "import type { Runtime } from '../../runtime/.spec/api.js'\nexport interface Console { readonly runtime: Runtime }\n",
      'unrelated/.spec/api.d.ts': 'export interface Unrelated { readonly name: string }\n',
    })
    fixtures.push(current)

    const focused = await selection(current.root, { select: ['.spec'], focused: true })
    expect(focused).toMatchObject({
      selected: ['.spec/api.d.ts'],
      support: ['runtime/.spec/api.d.ts', 'runtime/boot/.spec/api.d.ts'],
    })

    const changed = await selection(current.root, {
      select: ['runtime/boot'],
      focused: true,
      includeDependents: true,
    })
    expect(changed).toMatchObject({
      primary: ['runtime/boot/.spec/api.d.ts'],
      selected: ['runtime/.spec/api.d.ts', 'runtime/boot/.spec/api.d.ts'],
      support: [],
    })
  })

  it('reports derived statuses in JSON and one text line without changing the outcome', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/capability-report', type: 'module' }),
      '.spec/api.d.ts': 'export {}\n',
      '.spec/capabilities/kernel.ts':
        AUTHORING +
        capability(
          'KERNEL-BOOTS',
          "  laws: [{ module: 'runtime', id: 'RUNTIME-ORDERED' }],\n  capabilities: [{ module: 'runtime', id: 'RUNTIME-STARTS' }],\n",
        ) +
        capability('KERNEL-RECOVERS', "  laws: [{ module: 'runtime', id: 'RUNTIME-SKIPPED' }],\n") +
        capability('KERNEL-NAMED'),
      'runtime/.spec/api.d.ts': 'export {}\n',
      'runtime/.spec/capabilities/runtime.ts':
        AUTHORING + capability('RUNTIME-STARTS', "  laws: ['RUNTIME-ORDERED'],\n"),
      'runtime/.spec/laws/runtime.ts':
        AUTHORING +
        law(
          'RUNTIME-ORDERED',
          "  tests: [{ file: '__tests__/runtime.test.ts', id: 'RUNTIME-ORDERED' }],\n",
        ) +
        law(
          'RUNTIME-SKIPPED',
          "  tests: [\n    { file: '__tests__/runtime.test.ts', id: 'RUNTIME-SKIPPED' },\n    { file: '__tests__/runtime.test.ts', id: 'RUNTIME-LATER' },\n  ],\n",
        ),
      'runtime/__tests__/runtime.test.ts': `/** @evidence RUNTIME-ORDERED */
it('orders the runtime', () => {})
/** @evidence RUNTIME-SKIPPED */
it.skip('recovers the runtime', () => {})
/** @evidence RUNTIME-LATER */
it.todo('recovers the runtime later')
`,
    })
    fixtures.push(current)

    const json = await run(['check', current.root, '--format', 'json', '--no-cache'])
    expect(json).toMatchObject({ code: 0, stderr: '' })
    const report = JSON.parse(json.stdout) as {
      readonly status: string
      readonly capabilities: unknown
      readonly summary: unknown
    }
    expect(report.status).toBe('pass')
    expect(report.summary).toEqual({
      specifications: 2,
      diagnosticCauses: 0,
      diagnosticOccurrences: 0,
    })
    expect(report.capabilities).toEqual({
      declared: 1,
      partial: 1,
      held: 2,
      entries: [
        {
          module: '.',
          id: 'KERNEL-BOOTS',
          source: '.spec/capabilities/kernel.ts',
          status: 'held',
        },
        {
          module: '.',
          id: 'KERNEL-RECOVERS',
          source: '.spec/capabilities/kernel.ts',
          status: 'partial',
          blocking: { laws: [{ module: 'runtime', id: 'RUNTIME-SKIPPED' }], capabilities: [] },
        },
        {
          module: '.',
          id: 'KERNEL-NAMED',
          source: '.spec/capabilities/kernel.ts',
          status: 'declared',
        },
        {
          module: 'runtime',
          id: 'RUNTIME-STARTS',
          source: 'runtime/.spec/capabilities/runtime.ts',
          status: 'held',
        },
      ],
    })

    const text = await run(['check', current.root, '--quiet', '--no-cache'])
    expect(text).toEqual({
      code: 0,
      stdout:
        'Capabilities: 1 declared, 1 partial, 2 held.\nChecked 2 specifications: 0 diagnostics.\n',
      stderr: '',
    })

    const focused = await run([
      'check',
      current.root,
      '--select',
      '.spec',
      '--quiet',
      '--no-cache',
    ])
    expect(focused.stdout).toBe(
      'Capabilities: 1 declared, 1 partial, 2 held.\nChecked selected 1 specification (+1 support): 0 diagnostics.\n',
    )
  })

  it('keeps a corpus without capabilities silent in text and empty in JSON', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/capability-absent', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    fixtures.push(current)

    const text = await run(['check', current.root, '--quiet', '--no-cache'])
    expect(text).toEqual({
      code: 0,
      stdout: 'Checked 1 specification: 0 diagnostics.\n',
      stderr: '',
    })
    const json = await run(['check', current.root, '--format', 'json', '--no-cache'])
    expect((JSON.parse(json.stdout) as { readonly capabilities: unknown }).capabilities).toEqual({
      declared: 0,
      partial: 0,
      held: 0,
      entries: [],
    })
  })
})

type Citation = string | { readonly module: string; readonly id: string }

function module(
  root: string,
  capabilities: readonly (readonly [string, readonly Citation[], readonly Citation[]])[],
  laws: Readonly<Record<string, boolean>> = {},
): CapabilityDerivationModule {
  const source = `${root === '.' ? '' : `${root}/`}.spec/capabilities/module.ts`
  return {
    root,
    capabilities: [
      {
        ref: './capabilities/module.ts',
        source,
        text: '',
        revision: '',
        kind: 'capability',
        definitions: capabilities.map(([id, cited, composed]) => ({
          exportName: id.replaceAll('-', '_'),
          id,
          statement: `Statement of ${id}.`,
          ...(cited.length ? { laws: cited } : {}),
          ...(composed.length ? { capabilities: composed } : {}),
        })),
      },
    ],
    laws: Object.entries(laws).map(([id, active]) => ({ id, active })),
  }
}

async function selection(root: string, options: TypeSpecApplicationRefreshOptions) {
  const service = await createTypeSpecApplicationService({
    root,
    repository: 'fixture:capability-selection',
    analysis: { maximumRetainedGenerations: 2 },
  })
  try {
    return (await service.refresh({ compilerAnalysis: false, ...options })).snapshot.selection
  } finally {
    await service.dispose()
  }
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

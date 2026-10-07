import { execFile } from 'node:child_process'
import { symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { TypeSpecApplicationSnapshot } from '../application/index.ts'

import { specificationEvidenceInputs } from '../application/change/index.ts'
import { createTypeSpecApplicationService } from '../application/index.ts'
import { parseCommand, USAGE } from '../cli/parse.ts'
import {
  MODULE_TEST_EVIDENCE_PROFILE_ID,
  SPECIFICATION_VALIDITY_PROFILE_ID,
} from '../conformance/index.ts'
import { compileDescriptor } from '../specification/index.ts'
import { resolveCodeAnchors } from '../specification/module/code-anchor.ts'
import { fixture, type Fixture } from './fixture.ts'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')
const exec = promisify(execFile)
const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

const RESOLVER = `export const NAME = 'resolver'
export const [first, { nested }] = [1, { nested: 2 }]
export function validateRequirements(): void {
  function inner(): void {}
  inner()
}
export interface Requirements { readonly names: readonly string[] }
export type Verdict = 'admitted' | 'refused'
export enum Phase { Bundle }
export class Resolver {
  static #instances = 0
  readonly origin = NAME
  constructor(private readonly cache: Map<string, string>, plain: string) {}
  resolve(): string { return this.cache.get(NAME) ?? '' }
  get size(): number { return this.cache.size }
}
export const Factory = class { create(): void {} }
`

function law(id: string, code: string): string {
  return `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const ${id.replaceAll('-', '_')} = defineLaw({
  id: '${id}',
  statement: 'Statement of ${id}.',
  code: [
${code}  ],
})
`
}

describe('law code anchors', { timeout: 30_000 }, () => {
  /** @evidence SPECIFICATION-CODE-ANCHOR-SYNTACTIC */
  it('resolves files of any kind and JavaScript or TypeScript declarations syntactically', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export {}\n',
      // Resolution never imports or executes the anchored file.
      'module/src/resolver.ts': `${RESOLVER}throw new Error('must never execute')\n`,
      'module/src/legacy.mjs': 'export function legacy() {}\n',
      'module/proofs/Resolver.lean': 'theorem resolves : True := trivial\n',
      'shared/schema.sql': 'create table value (id text primary key);\n',
    })
    fixtures.push(current)

    const diagnostics = await anchors(
      current,
      law(
        'RESOLVER-VALIDATES',
        `    { file: 'src/resolver.ts' },
    { file: 'proofs/Resolver.lean' },
    { file: '../shared/schema.sql' },
    { file: 'src/legacy.mjs', symbol: 'legacy' },
    { file: 'src/resolver.ts', symbol: 'NAME' },
    { file: 'src/resolver.ts', symbol: 'nested' },
    { file: 'src/resolver.ts', symbol: 'validateRequirements' },
    { file: 'src/resolver.ts', symbol: 'Requirements' },
    { file: 'src/resolver.ts', symbol: 'Verdict' },
    { file: 'src/resolver.ts', symbol: 'Phase' },
    { file: 'src/resolver.ts', symbol: 'Resolver' },
    { file: 'src/resolver.ts', symbol: 'Resolver.resolve' },
    { file: 'src/resolver.ts', symbol: 'Resolver.size' },
    { file: 'src/resolver.ts', symbol: 'Resolver.origin' },
    { file: 'src/resolver.ts', symbol: 'Resolver.cache' },
    { file: 'src/resolver.ts', symbol: 'Resolver.constructor' },
    { file: 'src/resolver.ts', symbol: 'Resolver.#instances' },
    { file: 'src/resolver.ts', symbol: 'Factory.create' },
`,
      ),
    )

    expect(diagnostics).toEqual([])
  })

  it('reports a missing file, a missing symbol, and a symbol outside JavaScript or TypeScript', async () => {
    const current = await fixture({
      'module/.spec/api.d.ts': 'export {}\n',
      'module/src/resolver.ts': RESOLVER,
      'module/src/broken.ts': 'export function broken( {\n',
      'module/proofs/Resolver.lean': 'theorem resolves : True := trivial\n',
    })
    fixtures.push(current)
    const outside = await fixture({ 'escaped.ts': 'export const escaped = true\n' })
    fixtures.push(outside)
    await symlink(join(outside.root, 'escaped.ts'), join(current.root, 'module/src/linked.ts'))

    const diagnostics = await anchors(
      current,
      law(
        'RESOLVER-VALIDATES',
        `    { file: 'src/missing.ts' },
    { file: 'src/missing.ts', symbol: 'Resolver' },
    { file: 'src' },
    { file: 'src/resolver.ts', symbol: 'absent' },
    { file: 'src/resolver.ts', symbol: 'inner' },
    { file: 'src/resolver.ts', symbol: 'Resolver.absent' },
    { file: 'src/resolver.ts', symbol: 'Resolver.plain' },
    { file: 'src/resolver.ts', symbol: 'validateRequirements.inner' },
    { file: 'proofs/Resolver.lean', symbol: 'resolves' },
    { file: 'src/broken.ts', symbol: 'broken' },
    { file: '../../outside.ts' },
    { file: '${join(outside.root, 'escaped.ts')}' },
    { file: 'src/linked.ts' },
`,
      ),
    )

    const file = 'module/.spec/laws/resolver.ts'
    expect(diagnostics).toEqual([
      {
        code: 'CODE_ANCHOR_FILE_INVALID',
        message: 'Code anchor file cannot be read (ENOENT). (src/missing.ts)',
        file,
        line: 6,
        column: 5,
      },
      {
        code: 'CODE_ANCHOR_FILE_INVALID',
        message: 'Code anchor file cannot be read (ENOENT). (src/missing.ts#Resolver)',
        file,
        line: 7,
        column: 5,
      },
      {
        code: 'CODE_ANCHOR_FILE_INVALID',
        message: 'A code anchor must name a file. (src)',
        file,
        line: 8,
        column: 5,
      },
      {
        code: 'CODE_ANCHOR_SYMBOL_MISSING',
        message: 'No top-level declaration is named "absent". (src/resolver.ts#absent)',
        file,
        line: 9,
        column: 5,
      },
      {
        // A nested function is not a top-level declaration.
        code: 'CODE_ANCHOR_SYMBOL_MISSING',
        message: 'No top-level declaration is named "inner". (src/resolver.ts#inner)',
        file,
        line: 10,
        column: 5,
      },
      {
        code: 'CODE_ANCHOR_SYMBOL_MISSING',
        message: 'Class "Resolver" declares no member "absent". (src/resolver.ts#Resolver.absent)',
        file,
        line: 11,
        column: 5,
      },
      {
        // A plain constructor parameter declares no member.
        code: 'CODE_ANCHOR_SYMBOL_MISSING',
        message: 'Class "Resolver" declares no member "plain". (src/resolver.ts#Resolver.plain)',
        file,
        line: 12,
        column: 5,
      },
      {
        code: 'CODE_ANCHOR_SYMBOL_MISSING',
        message:
          'Top-level declaration "validateRequirements" is not a class. (src/resolver.ts#validateRequirements.inner)',
        file,
        line: 13,
        column: 5,
      },
      {
        code: 'CODE_ANCHOR_SYMBOL_UNSUPPORTED',
        message:
          'A code anchor symbol requires a JavaScript or TypeScript file. (proofs/Resolver.lean#resolves)',
        file,
        line: 14,
        column: 5,
      },
      expect.objectContaining({
        code: 'CODE_ANCHOR_FILE_INVALID',
        message: expect.stringMatching(/^Code anchor file has invalid syntax: .+ \(src\/broken\.ts#broken\)$/u),
        line: 15,
        column: 5,
      }),
      {
        code: 'CODE_ANCHOR_PATH_INVALID',
        message:
          'A code anchor must remain within the specification catalog root. (../../outside.ts)',
        file,
        line: 16,
        column: 5,
      },
      expect.objectContaining({
        code: 'CODE_ANCHOR_PATH_INVALID',
        message: expect.stringMatching(/^Code anchor paths must be relative to the module root\. /u),
        line: 17,
        column: 5,
      }),
      {
        code: 'CODE_ANCHOR_PATH_INVALID',
        message: 'A code anchor resolves outside the specification catalog root. (src/linked.ts)',
        file,
        line: 18,
        column: 5,
      },
    ])
  })

  it('parses and documents the law-evidence gate on check and changed', () => {
    expect(parseCommand(['check', '.'], {})).toMatchObject({ requireLawEvidence: false })
    expect(parseCommand(['check', '.', '--require-law-evidence'], {})).toMatchObject({
      name: 'check',
      requireLawEvidence: true,
    })
    expect(parseCommand(['changed', '.'], {})).toMatchObject({ requireLawEvidence: false })
    expect(parseCommand(['changed', '.', 'HEAD', '--require-law-evidence'], {})).toMatchObject({
      name: 'changed',
      base: 'HEAD',
      requireLawEvidence: true,
    })
    expect(() =>
      parseCommand(['check', '.', '--require-law-evidence', '--require-law-evidence'], {}),
    ).toThrow('Usage:')
    expect(() => parseCommand(['verify', '.', '--require-law-evidence'], {})).toThrow('Usage:')
    expect(
      USAGE.split('\n').filter((line) => line.includes('--require-law-evidence')),
    ).toEqual([
      expect.stringMatching(/^ {2}cg check /u),
      expect.stringMatching(/^ {2}cg changed /u),
    ])
  })

  /** @evidence CONFORMANCE-LAW-EVIDENCE-OPT-IN */
  it('requires a test reference or a code anchor on every law only on request', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/law-evidence', type: 'module' }),
      'module/.spec/api.d.ts': 'export {}\n',
      'module/.spec/laws/module.ts': `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const MODULE_TESTED = defineLaw({
  id: 'MODULE-TESTED',
  statement: 'A tested law.',
  tests: [{ file: '__tests__/module.test.ts', id: 'MODULE-TESTED' }],
})
export const MODULE_ANCHORED = defineLaw({
  id: 'MODULE-ANCHORED',
  statement: 'An anchored law.',
  code: [{ file: 'src/module.ts', symbol: 'anchored' }],
})
export const MODULE_ORPHAN = defineLaw({
  id: 'MODULE-ORPHAN',
  statement: 'A law attached to nothing.',
})
export const MODULE_EMPTY = defineLaw({
  id: 'MODULE-EMPTY',
  statement: 'A law with empty evidence lists.',
  tests: [],
  code: [],
})
`,
      'module/__tests__/module.test.ts': "/** @evidence MODULE-TESTED */\nit('is tested', () => {})\n",
      'module/src/module.ts': 'export function anchored(): void {}\n',
    })
    fixtures.push(current)

    const tolerant = await run(['check', current.root, '--quiet', '--no-cache'])
    expect(tolerant).toEqual({
      code: 0,
      stdout: 'Checked 1 specification: 0 diagnostics.\n',
      stderr: '',
    })

    const required = await run([
      'check',
      current.root,
      '--require-law-evidence',
      '--quiet',
      '--no-cache',
    ])
    expect(required).toEqual({
      code: 1,
      stdout: 'Checked 1 specification: 2 diagnostics.\n',
      stderr:
        'module/.spec/laws/module.ts:16:14 [LAW_EVIDENCE_REQUIRED] Law MODULE-EMPTY has neither a test reference nor a code anchor.\n' +
        'module/.spec/laws/module.ts:12:14 [LAW_EVIDENCE_REQUIRED] Law MODULE-ORPHAN has neither a test reference nor a code anchor.\n',
    })

    const tolerantRules = ruleNames(await qualify(current.root, {}))
    const requiredRules = ruleNames(await qualify(current.root, { requireLawEvidence: true }))
    expect(tolerantRules).toEqual(['MODULE-TEST-EVIDENCE-RESOLVES'])
    expect(requiredRules).toEqual(['MODULE-TEST-EVIDENCE-RESOLVES', 'MODULE-LAW-EVIDENCE-DECLARED'])
  })

  it('reports an unresolved anchor through check with the exact authored position', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/anchor-check', type: 'module' }),
      'module/.spec/api.d.ts': 'export {}\n',
      'module/.spec/laws/resolver.ts': law(
        'RESOLVER-VALIDATES',
        "    { file: 'src/resolver.ts', symbol: 'Resolver.resolve' },\n    { file: 'src/resolver.ts', symbol: 'Resolver.restore' },\n",
      ),
      'module/src/resolver.ts': RESOLVER,
    })
    fixtures.push(current)

    const json = await run(['check', current.root, '--format', 'json', '--no-cache'])
    expect(json.code).toBe(1)
    expect((JSON.parse(json.stdout) as { readonly diagnostics: unknown }).diagnostics).toEqual([
      {
        code: 'CODE_ANCHOR_SYMBOL_MISSING',
        message:
          'Class "Resolver" declares no member "restore". (src/resolver.ts#Resolver.restore)',
        file: 'module/.spec/laws/resolver.ts',
        line: 7,
        column: 5,
        pointers: [null],
      },
    ])
  })

  it('re-qualifies a citing owner when its evidence changes inside a deeper module', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/anchor-refresh', type: 'module' }),
      'outer/.spec/api.d.ts': 'export {}\n',
      'outer/.spec/laws/outer.ts': `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const OUTER_ANCHORED = defineLaw({
  id: 'OUTER-ANCHORED',
  statement: 'An outer law anchored in a deeper module.',
  tests: [{ file: 'inner/__tests__/inner.test.ts', id: 'OUTER-ANCHORED' }],
  code: [{ file: 'inner/src/value.ts', symbol: 'value' }],
})
`,
      'outer/inner/.spec/api.d.ts': 'export {}\n',
      'outer/inner/src/value.ts': 'export const value = true\n',
      'outer/inner/__tests__/inner.test.ts': "/** @evidence OUTER-ANCHORED */\nit('holds', () => {})\n",
    })
    fixtures.push(current)
    const service = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'fixture:anchor-refresh',
      analysis: { maximumRetainedGenerations: 2 },
    })
    const options = {
      qualify: true,
      compilerAnalysis: false,
      requestedCapabilities: [],
      requestedProfiles: [SPECIFICATION_VALIDITY_PROFILE_ID, MODULE_TEST_EVIDENCE_PROFILE_ID],
    } as const
    try {
      expect(diagnosticCodes((await service.refresh(options)).snapshot)).toEqual([])

      await current.write('outer/inner/src/value.ts', 'export const renamed = true\n')
      const anchored = await service.refresh({
        ...options,
        changed: [join(current.root, 'outer/inner/src/value.ts')],
      })
      expect(diagnosticCodes(anchored.snapshot)).toEqual(['CODE_ANCHOR_SYMBOL_MISSING'])

      await current.write('outer/inner/__tests__/inner.test.ts', "it('holds', () => {})\n")
      const tested = await service.refresh({
        ...options,
        changed: [join(current.root, 'outer/inner/__tests__/inner.test.ts')],
      })
      expect(diagnosticCodes(tested.snapshot)).toEqual([
        'CODE_ANCHOR_SYMBOL_MISSING',
        'TEST_EVIDENCE_TEST_MISSING',
      ])
    } finally {
      await service.dispose()
    }
  })

  it('indexes anchored files with attached tests as evidence inputs of their owner', () => {
    const laws = compileDescriptor(
      'law',
      'runtime/.spec/laws/runtime.ts',
      `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const RUNTIME_ORDERED = defineLaw({
  id: 'RUNTIME-ORDERED',
  statement: 'The runtime is ordered.',
  tests: [{ file: '__tests__/runtime.test.ts', id: 'RUNTIME-ORDERED' }],
  code: [
    { file: 'boot/src/order.ts', symbol: 'order' },
    { file: '../shared/order.sql' },
    { file: '../../outside.ts' },
  ],
})
`,
    )
    expect(
      specificationEvidenceInputs({
        root: 'runtime',
        laws: [
          {
            ref: './laws/runtime.ts',
            source: 'runtime/.spec/laws/runtime.ts',
            text: '',
            revision: '',
            kind: 'law',
            definitions: laws.definitions,
          },
        ],
        states: [],
      }),
    ).toEqual(['runtime/__tests__/runtime.test.ts', 'runtime/boot/src/order.ts', 'shared/order.sql'])
  })
})

async function anchors(current: Fixture, text: string) {
  const source = 'module/.spec/laws/resolver.ts'
  const compiled = compileDescriptor('law', source, text)
  expect(compiled.diagnostics).toEqual([])
  return resolveCodeAnchors(current.root, join(current.root, 'module'), [
    { source, text, definitions: compiled.definitions },
  ])
}

async function qualify(
  root: string,
  options: { readonly requireLawEvidence?: boolean },
): Promise<TypeSpecApplicationSnapshot> {
  const service = await createTypeSpecApplicationService({
    root,
    repository: 'fixture:law-evidence',
    analysis: { maximumRetainedGenerations: 2 },
  })
  try {
    return (
      await service.refresh({
        qualify: true,
        compilerAnalysis: false,
        requestedCapabilities: [],
        requestedProfiles: [SPECIFICATION_VALIDITY_PROFILE_ID, MODULE_TEST_EVIDENCE_PROFILE_ID],
        ...options,
      })
    ).snapshot
  } finally {
    await service.dispose()
  }
}

function ruleNames(snapshot: TypeSpecApplicationSnapshot): readonly string[] {
  return snapshot.qualifications.flatMap((qualification) =>
    qualification.profiles
      .filter((profile) => profile.id === MODULE_TEST_EVIDENCE_PROFILE_ID)
      .flatMap((profile) => profile.rules.map((rule) => rule.rule)),
  )
}

function diagnosticCodes(snapshot: TypeSpecApplicationSnapshot): readonly string[] {
  return snapshot.qualifications.flatMap((qualification) =>
    qualification.profiles.flatMap((profile) =>
      profile.rules.flatMap((rule) => rule.diagnostics.map((diagnostic) => diagnostic.code)),
    ),
  )
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

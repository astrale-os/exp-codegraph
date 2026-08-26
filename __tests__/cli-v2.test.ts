import { execFile } from 'node:child_process'
import { access, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import { parseCommand } from '../cli/parse.ts'
import { fixture, type Fixture } from './fixture.ts'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')
const exec = promisify(execFile)
const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('headless V2 CLI', { timeout: 30_000 }, () => {
  it('parses check, changed, test, verify, init, and development workflows', () => {
    expect(parseCommand(['--version'], {})).toEqual({ name: 'version' })
    expect(parseCommand(['check', '.', '--select', 'module'], {})).toMatchObject({
      name: 'check',
      select: ['module'],
      format: 'text',
    })
    expect(parseCommand(['check', '.', '--format', 'json'], {})).toMatchObject({
      name: 'check',
      format: 'json',
    })
    expect(() => parseCommand(['check', '.', '--format', 'yaml'], {})).toThrow('Usage:')
    expect(() =>
      parseCommand(['check', '.', '--format', 'json', '--format', 'text'], {}),
    ).toThrow('Usage:')
    expect(parseCommand(['changed', '.', 'HEAD', '--scope-only'], {})).toMatchObject({
      name: 'changed',
      base: 'HEAD',
      scopeOnly: true,
    })
    expect(parseCommand(['test', 'module'], {})).toMatchObject({
      name: 'test',
      select: ['module'],
    })
    expect(parseCommand(['verify', '.', '--require-pass'], {})).toMatchObject({
      name: 'verify',
      requirePass: true,
    })
    expect(parseCommand(['init', 'module'], {})).toMatchObject({ name: 'init' })
    expect(parseCommand(['dev', '.', '--port', '0'], {})).toMatchObject({
      name: 'dev',
      port: 0,
    })
  })

  it('reports the package version without initializing native analysis', async () => {
    const result = await run(['--version'])
    expect(result).toEqual({ code: 0, stdout: '0.1.0\n', stderr: '' })
  })

  it('checks a convention-only specification through the application service', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const result = await run(['check', current.root, '--quiet'])

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(result.stdout).toContain('Checked 1 specification: 0 diagnostics.')
  })

  it('returns stable authored diagnostics without invoking a second compiler authority', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface Value { readonly missing: Missing }\n',
    })
    const result = await run(['check', current.root, '--quiet'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('[API_TYPESCRIPT_TS2304]')
    expect(result.stderr).toContain('Cannot find name')
  })

  // @evidence CLI-CHECK-JSON-OUTPUT
  it('emits one replay-stable JSON report with text-equivalent failure semantics', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface Value { readonly missing: Missing }\n',
    })
    const cache = await fixture({})
    fixtures.push(cache)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }

    const text = await run(['check', current.root, '--quiet'], environment)
    const cold = await run(['check', current.root, '--format', 'json'], environment)
    const warm = await run(['check', current.root, '--format', 'json'], environment)
    const uncached = await run(
      ['check', current.root, '--format', 'json', '--no-cache'],
      environment,
    )

    expect(cold.code).toBe(text.code)
    expect(cold.code).toBe(1)
    expect(cold.stderr).toBe('')
    expect(warm).toEqual(cold)
    expect(uncached).toEqual(cold)
    const report = JSON.parse(cold.stdout) as {
      readonly format: string
      readonly version: number
      readonly command: string
      readonly status: string
      readonly evidence: { readonly repository: string; readonly inventory: string; readonly snapshot: string }
      readonly scope: { readonly kind: string; readonly specifications: readonly string[] }
      readonly qualificationFailed: boolean
      readonly diagnostics: readonly {
        readonly code: string
        readonly message: string
        readonly file: string
        readonly line: number
        readonly column: number
        readonly pointers: readonly (string | null)[]
      }[]
      readonly summary: {
        readonly specifications: number
        readonly diagnosticCauses: number
        readonly diagnosticOccurrences: number
      }
    }
    expect(report).toMatchObject({
      format: 'astrale.codegraph.check-report',
      version: 1,
      command: 'check',
      status: 'fail',
      scope: { kind: 'full', specifications: ['module/.spec/api.d.ts'] },
      qualificationFailed: true,
      summary: { specifications: 1 },
    })
    expect(report.evidence.repository).toMatch(/^repository:/u)
    expect(report.evidence.inventory).toMatch(/^source-manifest:/u)
    expect(report.evidence.snapshot).toMatch(/^application:/u)
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'API_TYPESCRIPT_TS2304',
          message: expect.stringContaining('Cannot find name'),
          file: expect.stringContaining('module/.spec/api.d.ts'),
          pointers: expect.any(Array),
        }),
      ]),
    )
    expect(report.summary.diagnosticCauses).toBe(report.diagnostics.length)
    expect(report.summary.diagnosticOccurrences).toBe(
      report.diagnostics.reduce((total, diagnostic) => total + diagnostic.pointers.length, 0),
    )
  })

  it('keeps focused checks advisory and reports only the selected owner closure', async () => {
    const current = await repository({
      'selected/.spec/api.d.ts': 'export interface Selected { readonly id: string }\n',
      'unrelated/.spec/api.d.ts': 'export interface Unrelated { readonly missing: Missing }\n',
    })
    const result = await run(['check', current.root, '--select', 'selected', '--quiet'])

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(result.stdout).toContain('Checked selected 1 specification: 0 diagnostics.')
  })

  it('reports the exact selected and support closure in focused JSON output', async () => {
    const current = await repository({
      'base/.spec/api.d.ts': 'export interface Base { readonly id: string }\n',
      'consumer/.spec/api.d.ts':
        "import type { Base } from '../../base/.spec/api.js'\nexport interface Consumer { readonly base: Base }\n",
    })
    const result = await run([
      'check',
      current.root,
      '--select',
      'consumer',
      '--format',
      'json',
      '--no-cache',
    ])

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'pass',
      qualificationFailed: false,
      scope: {
        kind: 'focused',
        requested: ['consumer'],
        selected: ['consumer/.spec/api.d.ts'],
        support: ['base/.spec/api.d.ts'],
      },
      diagnostics: [],
      summary: {
        specifications: 2,
        diagnosticCauses: 0,
        diagnosticOccurrences: 0,
      },
    })
  })

  it('initializes only the required contract and never overwrites it', async () => {
    const current = await repository({})
    const module = join(current.root, 'module')
    const initialized = await run(['init', module])

    expect(initialized.code).toBe(0)
    expect(initialized.stdout).toContain('Initialized')
    await expect(access(join(module, '.spec/api.d.ts'))).resolves.toBeUndefined()

    const repeated = await run(['init', module])
    expect(repeated.code).toBe(2)
    expect(repeated.stderr).toContain('already exists')
  })

  it('escapes control characters in authored diagnostic paths', async () => {
    const current = await repository({
      'evil\u001b[2J\nforged\u202e/.spec/api.d.ts':
        'export interface Value { readonly missing: Missing }\n',
    })
    const result = await run(['check', current.root, '--quiet'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('evil\\x1b[2J\\x0aforged\\u{202e}/.spec/api.d.ts')
    expect(result.stderr).not.toContain('\u001b[2J')
  })

  // @evidence CLI-CHECKPOINT-EXACT-ADMISSION
  it('replays an exact result and invalidates it on source change', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const cache = await fixture({})
    fixtures.push(cache)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }

    const cold = await run(['check', current.root, '--quiet'], environment)
    const started = performance.now()
    const warm = await run(['check', current.root, '--quiet'], environment)
    const warmMilliseconds = performance.now() - started

    expect(warm).toEqual(cold)
    expect(warmMilliseconds).toBeLessThan(5_000)
    const cacheFiles = await readdir(cache.root, { recursive: true })
    expect(cacheFiles).toEqual(expect.arrayContaining([expect.stringContaining('cli-check-')]))
    await current.write('module/.spec/api.d.ts', 'export interface Value { readonly id: Missin }\n')
    const changed = await run(['check', current.root, '--quiet'], environment)
    expect(changed.code).toBe(1)
    expect(changed.stderr).toContain('[API_TYPESCRIPT_TS2304]')
    expect(changed).not.toEqual(warm)
  })

  // @evidence CLI-CHECKPOINT-INVENTORY-CHURN
  it('invalidates exact results across create, rename, and delete inventory changes', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const cache = await fixture({})
    fixtures.push(cache)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }
    const original = await run(['check', current.root, '--quiet'], environment)

    await current.write(
      'added/.spec/api.d.ts',
      'export interface Added { readonly missing: Missing }\n',
    )
    const created = await run(['check', current.root, '--quiet'], environment)
    expect(created.code).toBe(1)
    expect(created.stderr).toContain('added/.spec/api.d.ts')

    await rename(join(current.root, 'added'), join(current.root, 'moved'))
    const renamed = await run(['check', current.root, '--quiet'], environment)
    expect(renamed.code).toBe(1)
    expect(renamed.stderr).toContain('moved/.spec/api.d.ts')
    expect(renamed.stderr).not.toContain('added/.spec/api.d.ts')

    await rm(join(current.root, 'moved'), { recursive: true })
    expect(await run(['check', current.root, '--quiet'], environment)).toEqual(original)
  })

  // @evidence CLI-CHECKPOINT-ADVISORY-RECOVERY
  it('falls back to the canonical check when the result artifact is corrupt', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const cache = await fixture({})
    fixtures.push(cache)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }
    const expected = await run(['check', current.root, '--quiet'], environment)
    const cacheFiles = await readdir(cache.root, { recursive: true })
    const manifestPath = cacheFiles.find((path) =>
      /\/manifests\/cli-check-[a-f0-9]{64}\.json$/u.test(path),
    )!
    const manifest = JSON.parse(await readFile(join(cache.root, manifestPath), 'utf8')) as {
      readonly artifacts: readonly { readonly digest: string }[]
    }
    const blob = join(
      dirname(join(cache.root, manifestPath)),
      '..',
      'blobs',
      'sha256',
      manifest.artifacts[0]!.digest,
    )
    await writeFile(blob, 'corrupt', 'utf8')

    expect(await run(['check', current.root, '--quiet'], environment)).toEqual(expected)
  })

  // @evidence CLI-CHECKPOINT-SELECTED-PROJECTION
  it('projects a selected check from a whole prime with no-cache output parity', async () => {
    const current = await repository({
      'selected/.spec/api.d.ts': 'export interface Selected { readonly id: string }\n',
      'unrelated/.spec/api.d.ts': 'export interface Unrelated { readonly missing: Missing }\n',
    })
    const cache = await fixture({})
    fixtures.push(cache)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }

    expect((await run(['check', current.root, '--quiet'], environment)).code).toBe(1)
    const started = performance.now()
    const projected = await run(
      ['check', current.root, '--select', 'selected', '--quiet'],
      environment,
    )
    const elapsedMilliseconds = performance.now() - started
    const oracle = await run(
      ['check', current.root, '--select', 'selected', '--quiet', '--no-cache'],
      environment,
    )

    expect(projected).toEqual(oracle)
    expect(projected).toMatchObject({ code: 0, stderr: '' })
    expect(elapsedMilliseconds).toBeLessThan(5_000)
    expect(await readdir(cache.root, { recursive: true })).toEqual(
      expect.arrayContaining([expect.stringContaining('cli-check-catalog-')]),
    )
  })

  // @evidence CLI-CHECKPOINT-CONCURRENT-PUBLISH
  it('publishes identical first-time selected results safely from concurrent processes', async () => {
    const current = await repository({
      'selected/.spec/api.d.ts': 'export interface Selected { readonly id: string }\n',
      'unrelated/.spec/api.d.ts': 'export interface Unrelated { readonly missing: Missing }\n',
    })
    const cache = await fixture({})
    fixtures.push(cache)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }
    await run(['check', current.root, '--quiet'], environment)
    const selected = ['check', current.root, '--select', 'selected', '--quiet'] as const

    const started = performance.now()
    const concurrent = await Promise.all([run(selected, environment), run(selected, environment)])
    const elapsedMilliseconds = performance.now() - started
    const oracle = await run([...selected, '--no-cache'], environment)

    expect(concurrent).toEqual([oracle, oracle])
    expect(elapsedMilliseconds).toBeLessThan(5_000)
  })

  it('replays a SourceProof-keyed semantic check pack from a relocated clean checkout', async () => {
    const current = await gitRepository({
      'selected/.spec/api.d.ts': 'export interface Selected { readonly id: string }\n',
    })
    const cache = await fixture({})
    const relocated = await fixture({})
    fixtures.push(cache, relocated)
    const environment = { ASTRALE_TYPESPEC_CACHE_DIR: cache.root, CI: 'false' }
    const cold = await run(
      ['check', current.root, '--select', 'selected', '--quiet'],
      environment,
    )
    await rm(relocated.root, { recursive: true, force: true })
    await exec('git', ['clone', '--quiet', current.root, relocated.root])
    const beforeWorkspaces = await readdir(join(cache.root, 'workspaces'))

    const started = performance.now()
    const replayed = await run(
      ['check', relocated.root, '--select', 'selected', '--quiet'],
      {
        ...environment,
        CI: 'true',
        ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR: join(cache.root, 'semantic-packs/checks'),
      },
    )
    const elapsedMilliseconds = performance.now() - started

    expect(replayed).toEqual(cold)
    expect(elapsedMilliseconds).toBeLessThan(3_000)
    expect(await readdir(join(cache.root, 'workspaces'))).toEqual(beforeWorkspaces)
    const semanticFiles = await readdir(join(cache.root, 'semantic-packs/checks'), {
      recursive: true,
    })
    expect(
      semanticFiles.filter((path) =>
        /(?:^|\/)manifests\/semantic-pack-[a-f0-9]{64}\.json$/u.test(path),
      ),
    ).toHaveLength(1)
  })
})

async function repository(files: Record<string, string>): Promise<Fixture> {
  const current = await fixture({
    'package.json': JSON.stringify({ name: '@fixture/codegraph-cli', type: 'module' }),
    ...files,
  })
  fixtures.push(current)
  return current
}

async function gitRepository(files: Record<string, string>): Promise<Fixture> {
  const current = await repository(files)
  await exec('git', ['-C', current.root, 'init', '--quiet'])
  await exec('git', ['-C', current.root, 'add', '--all'])
  await exec('git', [
    '-C',
    current.root,
    '-c',
    'user.name=Codegraph Fixture',
    '-c',
    'user.email=codegraph@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ])
  return current
}

async function run(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<{
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}> {
  try {
    const result = await exec(process.execPath, [cli, ...arguments_], {
      cwd: dirname(cli),
      env: { ...process.env, CI: 'true', NO_COLOR: '1', ...environment },
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

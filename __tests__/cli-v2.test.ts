import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
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

describe('headless V2 CLI', () => {
  it('parses check, changed, test, verify, init, and development workflows', () => {
    expect(parseCommand(['--version'], {})).toEqual({ name: 'version' })
    expect(parseCommand(['check', '.', '--select', 'module'], {})).toMatchObject({
      name: 'check',
      select: ['module'],
    })
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

  it('keeps focused checks advisory and reports only the selected owner closure', async () => {
    const current = await repository({
      'selected/.spec/api.d.ts': 'export interface Selected { readonly id: string }\n',
      'unrelated/.spec/api.d.ts': 'export interface Unrelated { readonly missing: Missing }\n',
    })
    const result = await run([
      'check',
      current.root,
      '--select',
      'selected',
      '--quiet',
    ])

    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(result.stdout).toContain('Checked selected 1 specification: 0 diagnostics.')
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
})

async function repository(files: Record<string, string>): Promise<Fixture> {
  const current = await fixture({
    'package.json': JSON.stringify({ name: '@fixture/codegraph-cli', type: 'module' }),
    ...files,
  })
  fixtures.push(current)
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
    const result = error as { readonly code?: number; readonly stdout?: string; readonly stderr?: string }
    return {
      code: typeof result.code === 'number' ? result.code : 2,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  }
}

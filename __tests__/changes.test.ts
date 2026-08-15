import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { changedSpecificationScope } from '../cli/changes.ts'
import { fixture, type Fixture } from './fixture.ts'

const exec = promisify(execFile)
const fixtures: Fixture[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('changed specification scope', () => {
  it('maps local implementation changes to their nearest specification owner', async () => {
    const current = await repository({
      'runtime/.spec/api.d.ts': 'export interface RuntimeAPI {}\n',
      'runtime/query/.spec/api.d.ts': 'export interface QueryAPI {}\n',
      'runtime/query/src/planner/index.ts': 'export const version = 1\n',
      'README.md': '# Fixture\n',
    })
    await current.write('runtime/query/src/planner/index.ts', 'export const version = 2\n')

    await expect(changedSpecificationScope(current.root, 'HEAD')).resolves.toEqual({
      kind: 'selected',
      base: 'HEAD',
      files: ['runtime/query/src/planner/index.ts'],
      targets: ['runtime/query'],
    })
  })

  it('falls back to a full check when specification tooling changes', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'spec/cli.ts': 'export {}\n',
    })
    await current.write('spec/cli.ts', 'export const changed = true\n')

    await expect(changedSpecificationScope(current.root, 'HEAD')).resolves.toMatchObject({
      kind: 'full',
      base: 'HEAD',
      files: ['spec/cli.ts'],
    })
  })

  it.each(['module/.spec/schemas/value.schema.json', 'module/.spec/packages/jose.ts'])(
    'uses full scope when a changed artifact participates in catalog authority: %s',
    async (file) => {
      const current = await repository({
        'module/.spec/api.d.ts': 'export interface API {}\n',
        [file]: file.endsWith('.json')
          ? JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema' })
          : "export default { package: 'jose', purpose: 'fixture' }\n",
      })
      await current.write(file, `${await text(current, file)}\n`)

      await expect(changedSpecificationScope(current.root, 'HEAD')).resolves.toEqual({
        kind: 'full',
        base: 'HEAD',
        files: [file],
        triggers: [file],
      })
    },
  )

  it('uses full scope when a shared extended TypeScript configuration changes', async () => {
    const current = await repository({
      'configs/base.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'tsconfig.json': JSON.stringify({ extends: './configs/base.json' }),
      'left/.spec/api.d.ts': 'export interface Left {}\n',
      'right/.spec/api.d.ts': 'export interface Right {}\n',
    })
    await current.write('configs/base.json', JSON.stringify({ compilerOptions: { strict: false } }))

    await expect(changedSpecificationScope(current.root, 'HEAD')).resolves.toEqual({
      kind: 'full',
      base: 'HEAD',
      files: ['configs/base.json'],
      triggers: ['configs/base.json'],
    })
  })

  it('returns targets relative to an explicitly scoped catalog root', async () => {
    const current = await repository({
      'packages/runtime/query/.spec/api.d.ts': 'export interface QueryAPI {}\n',
      'packages/runtime/query/index.ts': 'export const version = 1\n',
    })
    await current.write('packages/runtime/query/index.ts', 'export const version = 2\n')

    await expect(changedSpecificationScope(`${current.root}/packages`, 'HEAD')).resolves.toEqual({
      kind: 'selected',
      base: 'HEAD',
      files: ['packages/runtime/query/index.ts'],
      targets: ['runtime/query'],
    })
  })

  it('chooses the nearest remote ancestor instead of an unrelated remote default', async () => {
    vi.stubEnv('GITHUB_BASE_REF', 'main')
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/index.ts': 'export const version = 1\n',
    })
    const tree = await git(current.root, ['rev-parse', 'HEAD^{tree}'])
    const unrelated = await git(current.root, [
      '-c',
      'user.name=Spec Test',
      '-c',
      'user.email=spec@example.test',
      'commit-tree',
      tree,
      '-m',
      'unrelated remote main',
    ])
    await git(current.root, ['update-ref', 'refs/remotes/origin/main', unrelated])
    await git(current.root, ['update-ref', 'refs/remotes/origin/kernel-v2', 'HEAD'])
    await git(current.root, [
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
    ])
    await current.write('module/index.ts', 'export const version = 2\n')

    await expect(changedSpecificationScope(current.root)).resolves.toMatchObject({
      kind: 'selected',
      base: 'origin/kernel-v2',
      targets: ['module'],
    })
  })

  it('checks both former and new owners when implementation moves between modules', async () => {
    const current = await repository({
      'left/.spec/api.d.ts': 'export interface Left {}\n',
      'left/src/value.ts': 'export const value = 1\n',
      'right/.spec/api.d.ts': 'export interface Right {}\n',
    })
    await current.write('right/src/value.ts', 'export const value = 1\n')
    await rm(join(current.root, 'left/src/value.ts'))

    await expect(changedSpecificationScope(current.root, 'HEAD')).resolves.toEqual({
      kind: 'selected',
      base: 'HEAD',
      files: ['left/src/value.ts', 'right/src/value.ts'],
      targets: ['left', 'right'],
    })
  })

  it('falls back to full scope when a repository-root specification anchor is deleted', async () => {
    const current = await repository({
      '.spec/api.d.ts': 'export interface RootAPI {}\n',
      'README.md': '# Fixture\n',
    })
    await rm(join(current.root, '.spec/api.d.ts'))

    await expect(changedSpecificationScope(current.root, 'HEAD')).resolves.toEqual({
      kind: 'full',
      base: 'HEAD',
      files: ['.spec/api.d.ts'],
      triggers: ['.spec/api.d.ts'],
    })
  })

  it('unions committed, local, and untracked changes without duplicate paths', async () => {
    const current = await repository({
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/index.ts': 'export const version = 1\n',
    })
    const base = await git(current.root, ['rev-parse', 'HEAD'])
    await current.write('module/index.ts', 'export const version = 2\n')
    await git(current.root, ['add', 'module/index.ts'])
    await git(current.root, [
      '-c',
      'user.name=Spec Test',
      '-c',
      'user.email=spec@example.test',
      'commit',
      '-qm',
      'committed change',
    ])
    await current.write('module/index.ts', 'export const version = 3\n')
    await current.write('module/new.ts', 'export const created = true\n')

    await expect(changedSpecificationScope(current.root, base)).resolves.toEqual({
      kind: 'selected',
      base,
      files: ['module/index.ts', 'module/new.ts'],
      targets: ['module'],
    })
  })
})

async function repository(files: Record<string, string>): Promise<Fixture> {
  const current = await fixture(files)
  fixtures.push(current)
  await git(current.root, ['init', '-q'])
  await git(current.root, ['add', '.'])
  await git(current.root, [
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

async function git(root: string, args: string[]): Promise<string> {
  return (await exec('git', ['-C', root, ...args])).stdout.trim()
}

async function text(current: Fixture, file: string): Promise<string> {
  return (await exec('git', ['-C', current.root, 'show', `HEAD:${file}`])).stdout
}

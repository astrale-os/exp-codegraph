import { execFile } from 'node:child_process'
import { chmod, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import { createGitSourceProofProvider } from '../application/node/source-proof.ts'
import { applicationRepositoryExcludes } from '../application/discovery/scope.ts'
import type { SourceScope } from '../repository/index.ts'
import { fixture, type Fixture } from './fixture.ts'

const execute = promisify(execFile)
const fixtures: Fixture[] = []
const scope: SourceScope = {
  version: 'fixture-source-scope/1',
  exclude: ['.git/**', 'node_modules/**'],
  ignored: 'reject-semantic',
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('Git source proof', () => {
  it('admits one clean tree with a stable path-independent identity', async () => {
    const current = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    const provider = createGitSourceProofProvider()

    const first = await provider.admit(current.root, scope)
    const second = await provider.admit(current.root, scope)

    expect(first).toMatchObject({
      ok: true,
      proof: {
        format: 'astrale.codegraph.source-proof',
        version: 1,
        repositoryFormat: '0',
        overlay: [],
        changedPaths: [],
      },
    })
    expect(second).toEqual(first)
    if (first.ok) {
      expect(first.proof.objectFormat).toMatch(/^sha(?:1|256)$/u)
      expect(first.proof.headTree).toMatch(/^[0-9a-f]{40,64}$/u)
      expect(first.proof.id).toMatch(/^source-proof:[0-9a-f]{64}$/u)
    }
  })

  it('hashes only sorted dirty content, modes, symlinks, untracked files, and deletions', async () => {
    const current = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-overlay' }),
      'delete.txt': 'delete me\n',
      'script.sh': '#!/bin/sh\nexit 0\n',
    })
    await writeFile(join(current.root, 'script.sh'), '#!/bin/sh\nexit 1\n')
    await chmod(join(current.root, 'script.sh'), 0o755)
    await rm(join(current.root, 'delete.txt'))
    await writeFile(join(current.root, 'new.txt'), 'new\n')
    await symlink('new.txt', join(current.root, 'link.txt'))

    const admitted = await createGitSourceProofProvider().admit(current.root, scope)

    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    expect(admitted.proof.changedPaths).toEqual([
      'delete.txt',
      'link.txt',
      'new.txt',
      'script.sh',
    ])
    expect(admitted.proof.overlay).toEqual([
      { path: 'delete.txt', kind: 'deletion', previousMode: '100644' },
      expect.objectContaining({ path: 'link.txt', content: 'symlink', mode: '120000' }),
      expect.objectContaining({ path: 'new.txt', content: 'file', mode: '100644' }),
      expect.objectContaining({ path: 'script.sh', content: 'file', mode: '100755' }),
    ])
    for (const entry of admitted.proof.overlay) {
      if (entry.kind === 'content') expect(entry.digest).toMatch(/^[0-9a-f]{64}$/u)
    }
  })

  it('rejects ignored semantic inputs but permits explicitly excluded ignored paths', async () => {
    const current = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-ignored' }),
      '.gitignore': 'semantic.txt\nsemantic-dir/\nnode_modules/\n',
    })
    await writeFile(join(current.root, 'semantic.txt'), 'hidden semantic input\n')
    await mkdir(join(current.root, 'semantic-dir'))
    await writeFile(join(current.root, 'semantic-dir/value.ts'), 'export const hidden = true\n')

    const rejected = await createGitSourceProofProvider().admit(current.root, scope)
    const excluded = await createGitSourceProofProvider().admit(current.root, {
      ...scope,
      exclude: [...scope.exclude, 'semantic.txt', 'semantic-dir/**'],
    })

    expect(rejected).toMatchObject({ ok: false, code: 'proof-unsupported', retryable: false })
    expect(excluded).toMatchObject({ ok: true, proof: { overlay: [] } })
  })

  it('admits generated Husky control files without excluding user-authored hooks', async () => {
    const current = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-husky' }),
      '.gitignore': '.husky/_/\n',
      '.husky/pre-commit': 'pnpm test\n',
    })
    await mkdir(join(current.root, '.husky/_'), { recursive: true })
    await writeFile(join(current.root, '.husky/_/commit-msg'), '# generated\n')

    await expect(
      createGitSourceProofProvider().admit(current.root, {
        ...scope,
        exclude: applicationRepositoryExcludes(current.root, []),
      }),
    ).resolves.toMatchObject({ ok: true, proof: { overlay: [] } })
  })

  it('returns a visible fallback outside supported Git repositories', async () => {
    const current = await fixture({ 'package.json': '{}' })
    fixtures.push(current)

    await expect(createGitSourceProofProvider().admit(current.root, scope)).resolves.toMatchObject({
      ok: false,
      code: 'proof-unsupported',
      retryable: false,
    })
  })

  it('fails visibly for conflicts and sparse worktrees', async () => {
    const conflicted = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-conflict' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly branch: "base" }\n',
    })
    await git(conflicted.root, ['checkout', '--quiet', '-b', 'conflicting-branch'])
    await conflicted.write(
      'module/.spec/api.d.ts',
      'export interface Value { readonly branch: "other" }\n',
    )
    await commit(conflicted.root, 'other')
    await git(conflicted.root, ['checkout', '--quiet', '-'])
    await conflicted.write(
      'module/.spec/api.d.ts',
      'export interface Value { readonly branch: "current" }\n',
    )
    await commit(conflicted.root, 'current')
    await expect(
      execute('git', [
        '-C',
        conflicted.root,
        '-c',
        'user.name=Codegraph Fixture',
        '-c',
        'user.email=codegraph@example.invalid',
        'merge',
        '--quiet',
        'conflicting-branch',
      ]),
    ).rejects.toBeDefined()

    await expect(
      createGitSourceProofProvider().admit(conflicted.root, scope),
    ).resolves.toMatchObject({ ok: false, code: 'proof-conflict', retryable: false })

    const sparse = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-sparse' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    await git(sparse.root, ['sparse-checkout', 'init', '--cone'])
    await expect(createGitSourceProofProvider().admit(sparse.root, scope)).resolves.toMatchObject({
      ok: false,
      code: 'proof-unsupported',
      retryable: false,
    })
  })

  it('fails visibly for unreadable dirty inputs and dirty submodules', async () => {
    const unreadable = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-unreadable' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    const unreadableFile = join(unreadable.root, 'module/.spec/api.d.ts')
    await writeFile(unreadableFile, 'export interface Changed {}\n')
    await chmod(unreadableFile, 0)
    try {
      await expect(
        createGitSourceProofProvider().admit(unreadable.root, scope),
      ).resolves.toMatchObject({ ok: false, code: 'proof-unreadable', retryable: false })
    } finally {
      await chmod(unreadableFile, 0o644)
    }

    const child = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-submodule-child' }),
      'source.ts': 'export const value = 1\n',
    })
    const parent = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-submodule-parent' }),
    })
    await git(parent.root, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      '--quiet',
      child.root,
      'vendor/child',
    ])
    await commit(parent.root, 'add-submodule')
    await writeFile(join(parent.root, 'vendor/child/source.ts'), 'export const value = 2\n')

    await expect(createGitSourceProofProvider().admit(parent.root, scope)).resolves.toMatchObject({
      ok: false,
      code: 'proof-unsupported',
      retryable: false,
    })
  })

  it('honors cancellation without relabeling it as a fallback', async () => {
    const current = await gitFixture({ 'package.json': '{}' })
    const controller = new AbortController()
    controller.abort(new Error('fixture cancellation'))

    await expect(
      createGitSourceProofProvider().admit(current.root, scope, controller.signal),
    ).rejects.toThrow('fixture cancellation')
  })

  /** @evidence SOURCE-PROOF-MUTATION-FALLBACK */
  it('falls back after both admission attempts observe a mutating dirty source', async () => {
    const current = await gitFixture({
      'package.json': JSON.stringify({ name: '@fixture/source-proof-mutation' }),
      'module/.spec/api.d.ts': 'export interface Value {}\n',
    })
    const source = join(current.root, 'module/.spec/api.d.ts')
    await writeFile(source, Buffer.alloc(2 * 1_024 * 1_024, 0x61))
    let active = true
    const mutation = (async () => {
      let large = false
      while (active) {
        await truncate(source, (large ? 2 : 1) * 1_024 * 1_024)
        large = !large
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    })()
    try {
      await expect(createGitSourceProofProvider().admit(current.root, scope)).resolves.toMatchObject({
        ok: false,
        code: 'proof-unstable',
        retryable: true,
      })
    } finally {
      active = false
      await mutation
    }
  })
})

async function gitFixture(files: Record<string, string>): Promise<Fixture> {
  const current = await fixture(files)
  fixtures.push(current)
  await git(current.root, ['init', '--quiet'])
  await git(current.root, ['add', '--all'])
  await git(current.root, [
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

async function git(root: string, args: readonly string[]): Promise<void> {
  await execute('git', ['-C', root, ...args])
}

async function commit(root: string, message: string): Promise<void> {
  await git(root, ['add', '--all'])
  await git(root, [
    '-c',
    'user.name=Codegraph Fixture',
    '-c',
    'user.email=codegraph@example.invalid',
    'commit',
    '--quiet',
    '-m',
    message,
  ])
}

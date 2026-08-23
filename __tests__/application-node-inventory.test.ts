import { execFile } from 'node:child_process'
import { mkdir, rmdir, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'

import { deriveAnalysisId, type RepositoryId } from '../analysis/index.ts'
import {
  createCheckpointedRepositoryInventory,
  createGitRepositoryInventory,
  createNodeRepositoryInventory,
} from '../application/node/inventory.ts'
import { createRepositorySourceService, inventoryRepository } from '../repository/index.ts'
import { withOperationSnapshot } from '../source/operation-snapshot.ts'
import { createFileWorkspaceCheckpointStore } from '../workspace/checkpoint/index.ts'
import { fixture } from './fixture.ts'

const execute = promisify(execFile)

describe('Node repository inventory checkpoint', () => {
  it('projects a clean Git tree into the exact canonical byte inventory and visibly falls back dirty', async () => {
    const current = await fixture({
      'src/value.ts': 'export const value = 1\n',
      'src/asset.bin': new Uint8Array([0, 1, 2, 255]),
      'excluded/private.ts': 'export const hidden = true\n',
    })
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
    await mkdir(`${current.root}/src/empty`)
    const request = {
      root: current.root,
      repository: deriveAnalysisId('repository', 'test', { root: 'git-fixture' }) as RepositoryId,
      scope: { exclude: ['.git/**', 'excluded/**'] },
    }
    const decisions: unknown[] = []
    const optimized = createGitRepositoryInventory({
      root: current.root,
      onDecision: (decision) => decisions.push(decision),
    })
    const canonical = createNodeRepositoryInventory({ root: current.root })

    expect(await optimized(request)).toEqual(await canonical(request))
    const traversedBytes =
      Buffer.byteLength('export const value = 1\n') +
      4 +
      Buffer.byteLength('export const hidden = true\n')
    expect(decisions).toEqual([
      expect.objectContaining({
        outcome: 'used',
        code: 'clean-git-tree',
        filesTraversed: 3,
        bytesTraversed: traversedBytes,
        bytesHashed: traversedBytes,
        bytesRead: expect.any(Number),
      }),
    ])
    expect(
      (decisions[0] as { readonly bytesRead: number }).bytesRead,
    ).toBeGreaterThan(traversedBytes)

    const admitted = await withOperationSnapshot(async () => {
      const inventory = await optimized(request)
      return createRepositorySourceService(current.root, inventory).read({ path: 'src/value.ts' })
    })
    expect(admitted).toMatchObject({ status: 'current', text: 'export const value = 1\n' })

    await current.write('src/value.ts', 'export const value = 2\n')
    const dirty = await withOperationSnapshot(async () => {
      const inventory = await optimized(request)
      const source = await createRepositorySourceService(current.root, inventory).read({
        path: 'src/value.ts',
      })
      return { inventory, source }
    })
    expect(dirty.inventory).toEqual(await canonical(request))
    expect(dirty.source).toMatchObject({ status: 'current', text: 'export const value = 2\n' })
    expect(decisions.at(-1)).toEqual(
      expect.objectContaining({ outcome: 'fallback', code: 'dirty-worktree' }),
    )
    await current.remove()
  })

  it('reuses unchanged metadata and falls back after a same-size write', async () => {
    const current = await fixture({ 'src/value.ts': 'one\n' })
    const store = createFileWorkspaceCheckpointStore({ directory: `${current.root}/cache` })
    const fallback = vi.fn(inventoryRepository)
    const inventory = createCheckpointedRepositoryInventory({
      root: current.root,
      store,
      producerFingerprint: 'test/inventory/1',
      inventory: fallback,
    })
    const request = {
      root: current.root,
      repository: deriveAnalysisId('repository', 'test', { root: 'fixture' }) as RepositoryId,
      scope: { exclude: ['cache/**'] },
    }

    const first = await inventory(request)
    const second = await inventory(request)
    expect(second).toEqual(first)
    expect(fallback).toHaveBeenCalledTimes(1)

    const restarted = createCheckpointedRepositoryInventory({
      root: current.root,
      store,
      producerFingerprint: 'test/inventory/1',
      inventory: fallback,
    })
    expect(await restarted(request)).toEqual(first)
    expect(fallback).toHaveBeenCalledTimes(1)

    await writeFile(`${current.root}/src/value.ts`, 'two\n')
    const third = await restarted(request)
    expect(third.revision).not.toBe(first.revision)
    expect(fallback).toHaveBeenCalledTimes(2)

    await store.dispose()
    await current.remove()
  })

  // @evidence APPLICATION-INVENTORY-DIRECTORY-TOPOLOGY
  it('changes manifest identity when an admitted empty directory appears or disappears', async () => {
    const current = await fixture({ 'src/value.ts': 'one\n' })
    const store = createFileWorkspaceCheckpointStore({ directory: `${current.root}/cache` })
    const inventory = createCheckpointedRepositoryInventory({
      root: current.root,
      store,
      producerFingerprint: 'test/inventory/3',
    })
    const request = {
      root: current.root,
      repository: deriveAnalysisId('repository', 'test', {
        root: 'directory-fixture',
      }) as RepositoryId,
      scope: { exclude: ['cache/**'] },
    }
    const before = await inventory(request)

    await mkdir(`${current.root}/src/optional`)
    const added = await inventory(request)
    expect(added.files).toEqual(before.files)
    expect(added.revision).not.toBe(before.revision)

    await rmdir(`${current.root}/src/optional`)
    expect((await inventory(request)).revision).toBe(before.revision)
    await store.dispose()
    await current.remove()
  })
})

async function git(root: string, args: readonly string[]): Promise<void> {
  await execute('git', ['-C', root, ...args])
}

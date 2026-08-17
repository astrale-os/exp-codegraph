import { mkdir, rmdir, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { deriveAnalysisId, type RepositoryId } from '../analysis/index.ts'
import { createCheckpointedRepositoryInventory } from '../application/node/inventory.ts'
import { inventoryRepository } from '../repository/index.ts'
import { createFileWorkspaceCheckpointStore } from '../workspace/checkpoint/index.ts'
import { fixture } from './fixture.ts'

describe('Node repository inventory checkpoint', () => {
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

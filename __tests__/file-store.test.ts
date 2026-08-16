import { access, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createBoundedFileCacheStore,
  defaultTypeSpecCacheDirectory,
} from '../cache/file-store.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('bounded file cache store', () => {
  it('atomically bounds individual values, total bytes, and retained roots', async () => {
    const current = await fixture({})
    fixtures.push(current)
    const options = {
      directory: current.root,
      maxEntryBytes: 12,
      maxTotalBytes: 20,
      maxEntries: 2,
    }
    for (const key of ['alpha', 'beta', 'gamma']) {
      await createBoundedFileCacheStore({ ...options, key }).save(Buffer.alloc(10, key))
    }
    const files = (await readdir(current.root)).filter((file) => file.endsWith('.bin'))
    expect(files).toHaveLength(2)
    expect(
      (await Promise.all(files.map((file) => stat(join(current.root, file))))).reduce(
        (total, value) => total + value.size,
        0,
      ),
    ).toBeLessThanOrEqual(20)
    expect((await readdir(current.root)).some((file) => file.endsWith('.tmp'))).toBe(false)

    const oversize = createBoundedFileCacheStore({ ...options, key: 'oversize' })
    await oversize.save(Buffer.alloc(13))
    await expect(oversize.load()).resolves.toBeUndefined()
    await expect(access(join(current.root, 'oversize.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('uses one explicit override and otherwise selects the platform user cache', () => {
    expect(
      defaultTypeSpecCacheDirectory(
        { ASTRALE_TYPESPEC_CACHE_DIR: '/tmp/explicit' },
        'linux',
        '/home/fixture',
      ),
    ).toBe('/tmp/explicit')
    expect(defaultTypeSpecCacheDirectory({}, 'darwin', '/Users/fixture')).toBe(
      '/Users/fixture/Library/Caches/astrale-typespec/v2',
    )
    expect(
      defaultTypeSpecCacheDirectory({ XDG_CACHE_HOME: '/cache' }, 'linux', '/home/fixture'),
    ).toBe('/cache/astrale-typespec/v2')
  })

  it('rejects unsafe cache keys before touching the filesystem', () => {
    expect(() =>
      createBoundedFileCacheStore({
        directory: '/tmp/cache',
        key: '../escape',
        maxEntryBytes: 1,
        maxTotalBytes: 1,
        maxEntries: 1,
      }),
    ).toThrow('Cache keys must be lowercase safe names.')
  })
})

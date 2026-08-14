import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serialize } from 'node:v8'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RestorableCache } from '../cache/memory.ts'

import {
  createBoundedFileCacheStore,
  defaultTypeSpecCacheDirectory,
} from '../cache/file-store.ts'
import { createPersistentCacheSession } from '../cache/persistent.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('persistent content-addressed cache', () => {
  it('round-trips scoped Map evidence without owning its validation semantics', async () => {
    const current = await fixture({})
    fixtures.push(current)
    const store = createBoundedFileCacheStore({
      directory: current.root,
      key: 'roundtrip',
      maxEntryBytes: 1_024,
      maxTotalBytes: 2_048,
      maxEntries: 2,
    })
    let restored: unknown
    const cache: RestorableCache = {
      snapshot: (scope) =>
        new Map([
          ['scope', scope],
          ['value', { answer: 42 }],
        ]),
      restore: (_scope, snapshot) => {
        restored = snapshot
      },
    }
    await createPersistentCacheSession({
      format: 'fixture-v1',
      scope: current.root,
      store,
      participants: [{ name: 'fixture', cache }],
    }).save()
    await createPersistentCacheSession({
      format: 'fixture-v1',
      scope: current.root,
      store,
      participants: [{ name: 'fixture', cache }],
    }).restore()

    expect(restored).toEqual(
      new Map([
        ['scope', current.root],
        ['value', { answer: 42 }],
      ]),
    )
  })

  it('treats corruption and incompatible formats as removable misses', async () => {
    const current = await fixture({})
    fixtures.push(current)
    const store = createBoundedFileCacheStore({
      directory: current.root,
      key: 'corrupt',
      maxEntryBytes: 1_024,
      maxTotalBytes: 2_048,
      maxEntries: 2,
    })
    await mkdir(current.root, { recursive: true })
    await writeFile(join(current.root, 'corrupt.bin'), 'not compressed evidence')
    const cache: RestorableCache = { snapshot: () => [], restore: () => undefined }
    await expect(
      createPersistentCacheSession({
        format: 'fixture-v1',
        scope: current.root,
        store,
        participants: [{ name: 'fixture', cache }],
      }).restore(),
    ).resolves.toBeUndefined()
    await expect(access(join(current.root, 'corrupt.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    await createPersistentCacheSession({
      format: 'fixture-v1',
      scope: current.root,
      store,
      participants: [{ name: 'fixture', cache }],
    }).save()
    await createPersistentCacheSession({
      format: 'fixture-v2',
      scope: current.root,
      store,
      participants: [{ name: 'fixture', cache }],
    }).restore()
    await expect(access(join(current.root, 'corrupt.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('restores independent valid evidence when another participant is damaged', async () => {
    const restore = vi.fn()
    const remove = vi.fn(async () => undefined)
    const envelope = serialize({
      format: 'fixture-v1',
      scope: '/workspace',
      entries: new Map<string, Uint8Array>([
        ['damaged', Buffer.from('not gzip')],
        ['valid', gzipSync(serialize({ answer: 42 }))],
      ]),
    })
    const store = {
      load: async () => envelope,
      save: async () => undefined,
      remove,
    }

    await createPersistentCacheSession({
      format: 'fixture-v1',
      scope: '/workspace',
      store,
      participants: [
        { name: 'damaged', cache: { snapshot: () => [], restore: () => undefined } },
        { name: 'valid', cache: { snapshot: () => [], restore } },
      ],
    }).restore()

    expect(restore).toHaveBeenCalledWith('/workspace', { answer: 42 })
    expect(remove).toHaveBeenCalledOnce()
  })

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

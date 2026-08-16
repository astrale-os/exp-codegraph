import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createFileWorkspaceCheckpointStore,
  type WorkspaceCheckpointManifestInput,
} from '../workspace/checkpoint/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'codegraph-workspace-checkpoint-'))
  roots.push(value)
  return value
}

function manifest(payload: unknown, producerFingerprint = 'producer-v1'): WorkspaceCheckpointManifestInput {
  return {
    format: 'codegraph.workspace-checkpoint',
    version: 1,
    producerFingerprint,
    payload: payload as WorkspaceCheckpointManifestInput['payload'],
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function manifestFile(rootPath: string, scope: string): Promise<string> {
  return join(rootPath, 'manifests', `${scope}.json`)
}

describe('workspace checkpoint store', () => {
  it('round-trips a JSON manifest and content-addressed artifacts', async () => {
    const directory = await root()
    const store = createFileWorkspaceCheckpointStore({ directory })
    const source = Buffer.from('source text')
    const graph = Buffer.from('{"nodes":2}')

    await store.publish('workspace-one', {
      manifest: manifest({ project: 'one', generation: 2 }),
      artifacts: new Map([
        ['source', source],
        ['graph', graph],
      ]),
    })

    const loaded = await store.load('workspace-one')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.manifest).toMatchObject({
      format: 'codegraph.workspace-checkpoint',
      version: 1,
      scope: 'workspace-one',
      producerFingerprint: 'producer-v1',
      payload: { project: 'one', generation: 2 },
    })
    expect([...loaded.artifacts.entries()]).toEqual([
      ['graph', graph],
      ['source', source],
    ])
    expect(loaded.manifest.artifacts).toEqual([
      { key: 'graph', digest: digest(graph), bytes: graph.byteLength },
      { key: 'source', digest: digest(source), bytes: source.byteLength },
    ])
  })

  it('writes deterministic canonical JSON and sorted artifact descriptors', async () => {
    const firstDirectory = await root()
    const secondDirectory = await root()
    const first = createFileWorkspaceCheckpointStore({ directory: firstDirectory })
    const second = createFileWorkspaceCheckpointStore({ directory: secondDirectory })
    const firstBytes = Buffer.from('first')
    const secondBytes = Buffer.from('second')

    await first.publish('stable', {
      manifest: manifest({ z: 1, a: ['x', 'y'] }),
      artifacts: {
        zeta: secondBytes,
        alpha: firstBytes,
      },
    })
    await second.publish('stable', {
      manifest: manifest({ a: ['x', 'y'], z: 1 }),
      artifacts: new Map([
        ['alpha', firstBytes],
        ['zeta', secondBytes],
      ]),
    })

    expect(await readFile(await manifestFile(firstDirectory, 'stable'))).toEqual(
      await readFile(await manifestFile(secondDirectory, 'stable')),
    )
  })

  /** @evidence CHECKPOINT-ADVISORY-MISS */
  it('returns typed misses for corrupt, missing, and oversized blobs', async () => {
    const directory = await root()
    const store = createFileWorkspaceCheckpointStore({ directory, maxArtifactBytes: 32 })
    const source = Buffer.from('valid')
    await store.publish('damaged', { manifest: manifest({}), artifacts: { source } })
    const blob = join(directory, 'blobs', 'sha256', digest(source))

    await writeFile(blob, Buffer.from('corrupt'))
    await expect(store.load('damaged')).resolves.toMatchObject({ ok: false, reason: 'artifact-corrupt' })

    await rm(blob)
    await expect(store.load('damaged')).resolves.toMatchObject({ ok: false, reason: 'artifact-missing' })

    await writeFile(blob, Buffer.alloc(source.byteLength))
    await expect(store.load('damaged')).resolves.toMatchObject({ ok: false, reason: 'artifact-corrupt' })

    const oversizedDirectory = await root()
    const oversized = createFileWorkspaceCheckpointStore({ directory: oversizedDirectory, maxArtifactBytes: 4 })
    await expect(
      oversized.publish('too-large', { manifest: manifest({}), artifacts: { source: Buffer.alloc(5) } }),
    ).rejects.toThrow('maxArtifactBytes')
  })

  /** @evidence CHECKPOINT-ATOMIC-PUBLICATION */
  it('ignores stale temporary files and atomically replaces a scope manifest', async () => {
    const directory = await root()
    const store = createFileWorkspaceCheckpointStore({ directory })
    await store.publish('replaceable', { manifest: manifest({ generation: 1 }), artifacts: {} })
    const temporary = join(directory, 'manifests', '.replaceable.old.tmp')
    await writeFile(temporary, 'incomplete')
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000)
    await utimes(temporary, old, old)

    await store.publish('replaceable', { manifest: manifest({ generation: 2 }), artifacts: {} })
    const loaded = await store.load('replaceable')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.manifest.payload).toEqual({ generation: 2 })
    expect((await readdir(join(directory, 'manifests'))).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })

  it('rejects traversal and preserves shared blobs when one scope is removed', async () => {
    const directory = await root()
    const store = createFileWorkspaceCheckpointStore({ directory })
    const shared = Buffer.from('shared artifact')
    await expect(store.load('../escape')).rejects.toThrow('lowercase safe identifiers')
    await expect(
      store.publish('../escape', { manifest: manifest({}), artifacts: { shared } }),
    ).rejects.toThrow('lowercase safe identifiers')

    await store.publish('left', { manifest: manifest({ side: 'left' }), artifacts: { shared } })
    await store.publish('right', { manifest: manifest({ side: 'right' }), artifacts: { shared } })
    const blob = join(directory, 'blobs', 'sha256', digest(shared))
    await expect(stat(blob)).resolves.toMatchObject({ isFile: expect.any(Function) })

    await store.remove('left')
    await expect(stat(blob)).resolves.toMatchObject({ isFile: expect.any(Function) })
    const right = await store.load('right')
    expect(right.ok).toBe(true)
  })

  it('enforces manifest, artifact-count, and total-byte bounds', async () => {
    const directory = await root()
    const store = createFileWorkspaceCheckpointStore({
      directory,
      maxManifestBytes: 128,
      maxArtifacts: 1,
      maxTotalBytes: 4,
    })
    await expect(
      store.publish('many', {
        manifest: manifest({}),
        artifacts: { a: Buffer.from('a'), b: Buffer.from('b') },
      }),
    ).rejects.toThrow('more than 1 artifacts')
    await expect(
      store.publish('total', { manifest: manifest({}), artifacts: { a: Buffer.alloc(5) } }),
    ).rejects.toThrow('maxTotalBytes')

    const narrow = createFileWorkspaceCheckpointStore({ directory: await root(), maxManifestBytes: 64 })
    await expect(
      narrow.publish('manifest-too-large', { manifest: manifest({ text: 'x'.repeat(100) }), artifacts: {} }),
    ).rejects.toThrow('maxManifestBytes')
  })

  it('bounds retained named scopes while preserving the latest publication', async () => {
    const directory = await root()
    const store = createFileWorkspaceCheckpointStore({ directory, maximumScopes: 2 })
    await store.publish('first', { manifest: manifest({}), artifacts: {} })
    await store.publish('second', { manifest: manifest({}), artifacts: {} })
    await store.publish('third', { manifest: manifest({}), artifacts: {} })

    expect((await readdir(join(directory, 'manifests'))).filter((name) => name.endsWith('.json')))
      .toHaveLength(2)
    expect(await store.load('third')).toMatchObject({ ok: true })
  })
})

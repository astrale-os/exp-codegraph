import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerCatalogCheckpoint } from '../server/catalog-checkpoint.ts'
import {
  catalogProjectionTopology,
  type CatalogSnapshot,
} from '../server/catalog-snapshot.ts'
import {
  CATALOG_INDEX_FORMAT,
  CATALOG_SPEC_FORMAT,
  CATALOG_TRANSPORT_VERSION,
  type CatalogSpecPayload,
} from '../viewer-host/catalog.ts'

const roots: string[] = []
const originalCache = process.env.ASTRALE_TYPESPEC_CACHE_DIR

afterEach(async () => {
  if (originalCache === undefined) delete process.env.ASTRALE_TYPESPEC_CACHE_DIR
  else process.env.ASTRALE_TYPESPEC_CACHE_DIR = originalCache
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('server catalog checkpoint', () => {
  it('round-trips independently encoded catalog records instead of one repository blob', async () => {
    const directory = await temporary('codegraph-catalog-cache-')
    const root = await temporary('codegraph-catalog-root-')
    process.env.ASTRALE_TYPESPEC_CACHE_DIR = directory
    const checkpoint = await createServerCatalogCheckpoint(root)
    const snapshot = `application:${'a'.repeat(64)}` as const
    const repeated = 'repeated presentation text '.repeat(32_000)
    const alpha = payload('alpha/.spec/api.d.ts', '1'.repeat(64), repeated)
    const beta = {
      ...payload('beta/.spec/api.d.ts', '2'.repeat(64), repeated),
      format: 'corrupt-but-lazy',
    } as unknown as CatalogSpecPayload
    const catalog = catalogSnapshot(snapshot, [alpha, beta])

    try {
      await checkpoint.publish(catalog)
      const restored = await checkpoint.load(snapshot, {})
      expect(restored?.index).toEqual(catalog.index)
      expect(restored?.specs.size).toBe(2)
      expect(restored?.specs.get(`alpha/.spec/api.d.ts\0${'1'.repeat(64)}`)).toEqual(alpha)
      await checkpoint.publish(restored!)
      expect(() => restored?.specs.get(`beta/.spec/api.d.ts\0${'2'.repeat(64)}`))
        .toThrow('payload is invalid')
    } finally {
      await checkpoint.dispose()
    }

    const workspace = createHash('sha256').update(resolve(root)).digest('hex')
    const manifest = JSON.parse(
      await readFile(
        join(directory, 'workspaces', workspace, 'viewer', 'manifests', 'viewer-catalog.json'),
        'utf8',
      ),
    ) as { readonly artifacts: readonly { readonly bytes: number }[] }
    expect(manifest.artifacts).toHaveLength(3)
    expect(manifest.artifacts.reduce((total, artifact) => total + artifact.bytes, 0))
      .toBeLessThan(Buffer.byteLength(JSON.stringify([alpha, beta]), 'utf8') / 10)
  })

  it('drops malformed persisted verification records instead of crashing restoration', async () => {
    const directory = await temporary('codegraph-verification-cache-')
    const root = await temporary('codegraph-verification-root-')
    process.env.ASTRALE_TYPESPEC_CACHE_DIR = directory
    const checkpoint = await createServerCatalogCheckpoint(root)
    try {
      await checkpoint.publishVerifications([{
        source: 'alpha/.spec/api.d.ts',
        revision: 'a'.repeat(64),
        inputs: 'b'.repeat(64),
        verification: { status: 'pass' },
      } as never])
      await expect(checkpoint.loadVerifications()).resolves.toEqual([])
    } finally {
      await checkpoint.dispose()
    }
  })
})

function payload(source: string, revision: string, repeated: string): CatalogSpecPayload {
  return {
    format: CATALOG_SPEC_FORMAT,
    version: CATALOG_TRANSPORT_VERSION,
    source,
    revision,
    spec: { source, repeated } as unknown as CatalogSpecPayload['spec'],
  }
}

function catalogSnapshot(
  snapshot: `application:${string}`,
  payloads: readonly CatalogSpecPayload[],
): CatalogSnapshot {
  const specifications = payloads.map((payload) => ({ source: payload.source, modules: [] }))
  return {
    index: {
      format: CATALOG_INDEX_FORMAT,
      version: CATALOG_TRANSPORT_VERSION,
      generation: 'f'.repeat(64),
      snapshot,
      specs: payloads.map((payload) => ({
        source: payload.source,
        title: payload.source,
        revision: payload.revision,
        metrics: { errors: 0, open: 0, status: 'ok' },
      })),
      diagnostics: [],
    },
    indexModule: 'not persisted',
    specs: new Map(payloads.map((value) => [`${value.source}\0${value.revision}`, value])),
    sources: new Map(),
    inputs: new Map(),
    projection: {
      specifications,
      sourceKeys: payloads.map((payload) => ({ source: payload.source, keys: [] })),
    },
    topology: catalogProjectionTopology(specifications),
  }
}

async function temporary(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}

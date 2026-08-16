import { createHash } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { opendir, readFile, stat } from 'node:fs/promises'
import { join, matchesGlob, resolve } from 'node:path'

import type {
  RepositoryInventory,
  RepositoryInventoryOptions,
  RepositoryScanEntry,
  RepositoryScanner,
} from '../../repository/index.ts'
import { inventoryRepository } from '../../repository/index.ts'
import type { FileWorkspaceCheckpointStore } from '../../workspace/checkpoint/index.ts'

const FORMAT = 'astrale.codegraph.repository-inventory-checkpoint'
const VERSION = 1
const SCOPE = 'repository-inventory'
const INVENTORY = 'repository/inventory.json'
const ENTRIES = 'repository/entries.json'

export interface CheckpointedRepositoryInventoryOptions {
  readonly root: string
  readonly store: FileWorkspaceCheckpointStore
  readonly producerFingerprint: string
  readonly inventory?: typeof inventoryRepository
}

/**
 * Reuse an exact content inventory when the filesystem proves that no ordinary write, create,
 * delete, or rename occurred. Metadata is only a preflight: any uncertainty takes the canonical
 * byte-reading inventory path.
 */
export function createCheckpointedRepositoryInventory(
  options: CheckpointedRepositoryInventoryOptions,
): typeof inventoryRepository {
  const root = resolve(options.root)
  const fallback = options.inventory ?? inventoryRepository
  let retained: RetainedInventory | undefined
  return async (request) => {
    if (resolve(request.root) !== root || request.scanner || request.classifiers) {
      return fallback(request)
    }
    const scopeFingerprint = digestJson(request.scope ?? {})
    let metadata: readonly RepositoryFileMetadata[]
    try {
      metadata = await scanMetadata(root, '', request.scope?.exclude ?? [], request.signal)
    } catch {
      return fallback(request)
    }
    const metadataFingerprint = digestJson(metadata)
    let previous =
      retained?.repository === request.repository && retained.scope === scopeFingerprint
        ? retained
        : undefined
    if (previous && digestJson(previous.entries.map((entry) => entry.metadata)) === metadataFingerprint) {
      return previous.inventory
    }
    if (!previous) {
      try {
        const loaded = await options.store.load(SCOPE, signalOptions(request))
        if (
          loaded.ok &&
          loaded.manifest.format === FORMAT &&
          loaded.manifest.version === VERSION &&
          loaded.manifest.producerFingerprint === options.producerFingerprint &&
          isRecord(loaded.manifest.payload) &&
          loaded.manifest.payload.repository === request.repository &&
          loaded.manifest.payload.scope === scopeFingerprint
        ) {
          const inventoryBytes = loaded.artifacts.get(INVENTORY)
          const entriesBytes = loaded.artifacts.get(ENTRIES)
          if (inventoryBytes && entriesBytes) {
            const inventory = JSON.parse(
              Buffer.from(inventoryBytes).toString('utf8'),
            ) as RepositoryInventory
            const entriesValue: unknown = JSON.parse(Buffer.from(entriesBytes).toString('utf8'))
            if (
              inventory.repository === request.repository &&
              typeof inventory.revision === 'string' &&
              Array.isArray(inventory.files) &&
              isCachedEntries(entriesValue)
            ) {
              previous = {
                repository: request.repository,
                scope: scopeFingerprint,
                inventory,
                entries: entriesValue,
              }
              retained = previous
              if (loaded.manifest.payload.metadata === metadataFingerprint) return inventory
            }
          }
        }
      } catch {
        // Advisory miss: the canonical inventory below remains the sole semantic authority.
      }
    }
    let entries: readonly CachedRepositoryEntry[]
    let inventory: RepositoryInventory
    try {
      entries = await hydrateEntries(root, metadata, previous?.entries ?? [], request.signal)
      inventory = await fallback({
        ...request,
        scanner: scanner(entries),
      })
    } catch {
      return fallback(request)
    }
    retained = {
      repository: request.repository,
      scope: scopeFingerprint,
      inventory,
      entries,
    }
    try {
      await options.store.publish(
        SCOPE,
        {
          manifest: {
            format: FORMAT,
            version: VERSION,
            producerFingerprint: options.producerFingerprint,
            payload: {
              repository: request.repository,
              scope: scopeFingerprint,
              metadata: metadataFingerprint,
              inventory: inventory.revision,
            },
          },
          artifacts: {
            [INVENTORY]: Buffer.from(JSON.stringify(inventory), 'utf8'),
            [ENTRIES]: Buffer.from(JSON.stringify(entries), 'utf8'),
          },
        },
        signalOptions(request),
      )
    } catch {
      // A read-only or damaged cache never changes the successful canonical result.
    }
    return inventory
  }
}

interface RetainedInventory {
  readonly repository: RepositoryInventory['repository']
  readonly scope: string
  readonly inventory: RepositoryInventory
  readonly entries: readonly CachedRepositoryEntry[]
}

interface RepositoryFileMetadata {
  readonly path: string
  readonly device: string
  readonly inode: string
  readonly bytes: string
  readonly modified: string
  readonly changed: string
}

interface CachedRepositoryEntry extends RepositoryScanEntry {
  readonly metadata: RepositoryFileMetadata
}

async function hydrateEntries(
  root: string,
  metadata: readonly RepositoryFileMetadata[],
  previous: readonly CachedRepositoryEntry[],
  signal?: AbortSignal,
): Promise<readonly CachedRepositoryEntry[]> {
  const before = new Map(previous.map((entry) => [entry.path, entry] as const))
  const entries: CachedRepositoryEntry[] = []
  for (const current of metadata) {
    signal?.throwIfAborted()
    const retained = before.get(current.path)
    if (retained && sameMetadata(retained.metadata, current)) {
      entries.push(retained)
      continue
    }
    const file = join(root, ...current.path.split('/'))
    const bytes = await readFile(file, { signal })
    const verified = await fileMetadata(current.path, file)
    if (!sameMetadata(current, verified) || bytes.byteLength !== Number(verified.bytes)) {
      throw new Error(`Repository file changed while it was being inventoried: ${current.path}`)
    }
    entries.push({
      path: current.path,
      bytes: bytes.byteLength,
      digest: createHash('sha256').update(bytes).digest('hex'),
      content: isUtf8(bytes) ? 'text' : 'binary',
      metadata: current,
    })
  }
  return entries
}

function scanner(entries: readonly CachedRepositoryEntry[]): RepositoryScanner {
  return {
    async *scan() {
      for (const { path, bytes, digest, content } of entries) {
        yield { path, bytes, digest, content }
      }
    },
  }
}

async function scanMetadata(
  root: string,
  relative: string,
  exclude: readonly string[],
  signal?: AbortSignal,
): Promise<readonly RepositoryFileMetadata[]> {
  signal?.throwIfAborted()
  const directory = await opendir(relative ? join(root, relative) : root)
  const entries = []
  for await (const entry of directory) entries.push(entry)
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const files: RepositoryFileMetadata[] = []
  for (const entry of entries) {
    signal?.throwIfAborted()
    const path = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (path === '.git' || path.startsWith('.git/') || directoryExcluded(path, exclude)) continue
      files.push(...(await scanMetadata(root, path, exclude, signal)))
      continue
    }
    if (!entry.isFile()) continue
    files.push(await fileMetadata(path, join(root, ...path.split('/'))))
  }
  return files
}

async function fileMetadata(path: string, file: string): Promise<RepositoryFileMetadata> {
  const metadata = await stat(file, { bigint: true })
  return {
    path,
    device: String(metadata.dev),
    inode: String(metadata.ino),
    bytes: String(metadata.size),
    modified: String(metadata.mtimeNs),
    changed: String(metadata.ctimeNs),
  }
}

function sameMetadata(left: RepositoryFileMetadata, right: RepositoryFileMetadata): boolean {
  return (
    left.path === right.path &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.bytes === right.bytes &&
    left.modified === right.modified &&
    left.changed === right.changed
  )
}

function isCachedEntries(value: unknown): value is readonly CachedRepositoryEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.path === 'string' &&
        typeof entry.bytes === 'number' &&
        typeof entry.digest === 'string' &&
        (entry.content === 'text' || entry.content === 'binary') &&
        isRecord(entry.metadata) &&
        typeof entry.metadata.path === 'string' &&
        typeof entry.metadata.device === 'string' &&
        typeof entry.metadata.inode === 'string' &&
        typeof entry.metadata.bytes === 'string' &&
        typeof entry.metadata.modified === 'string' &&
        typeof entry.metadata.changed === 'string',
    )
  )
}

function directoryExcluded(path: string, patterns: readonly string[]): boolean {
  return patterns.some(
    (pattern) =>
      matchesGlob(path, pattern) ||
      matchesGlob(`${path}/__entry__`, pattern) ||
      (!/[?*\[\]{}]/u.test(pattern) && (path === pattern || path.startsWith(`${pattern}/`))),
  )
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function signalOptions(
  request: RepositoryInventoryOptions,
): { readonly signal?: AbortSignal } {
  return request.signal ? { signal: request.signal } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

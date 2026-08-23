import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'
import { opendir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type {
  RepositoryInventory,
  RepositoryInventoryOptions,
  RepositoryScanEntry,
  RepositoryScanner,
  SourceProofProvider,
} from '../../repository/index.ts'

import { deriveAnalysisId, type SourceManifestId } from '../../analysis/index.ts'
import { inventoryRepository } from '../../repository/index.ts'
import {
  decodeWorkspaceCheckpointJson,
  encodeWorkspaceCheckpointJson,
  WORKSPACE_CHECKPOINT_JSON_ENCODING,
  type FileWorkspaceCheckpointStore,
} from '../../workspace/checkpoint/index.ts'
import { seedOperationSourceText } from '../../source/operation-snapshot.ts'
import { TYPE_SPEC_APPLICATION_LIMITS } from '../limits.ts'
import { inventoryGitHead } from './git-inventory.optimization.ts'
import { captureGitExecutable, createGitSourceProofProvider } from './source-proof.ts'
import {
  repositoryDirectoryExcluded,
  repositoryDirectoryTopologyFingerprint,
} from './topology.ts'

export { repositoryDirectoryTopologyFingerprint } from './topology.ts'

const FORMAT = 'astrale.codegraph.repository-inventory-checkpoint'
const VERSION = 3
const SCOPE = 'repository-inventory'
const INVENTORY = 'repository/inventory.json.br'
const ENTRIES = 'repository/entries.json.br'
const MAXIMUM_DECODED_ARTIFACT_BYTES =
  TYPE_SPEC_APPLICATION_LIMITS.maximumDecodedCheckpointArtifactBytes

export interface CheckpointedRepositoryInventoryOptions {
  readonly root: string
  readonly store: FileWorkspaceCheckpointStore
  readonly producerFingerprint: string
  readonly inventory?: typeof inventoryRepository
}

export interface NodeRepositoryInventoryOptions {
  readonly root: string
  readonly inventory?: typeof inventoryRepository
}

export interface GitRepositoryInventoryOptions extends NodeRepositoryInventoryOptions {
  readonly proof?: SourceProofProvider
  readonly onDecision?: (decision: {
    readonly outcome: 'used' | 'fallback'
    readonly code: string
    readonly durationMs: number
    readonly proofMs?: number
    readonly treeMs?: number
    readonly blobsMs?: number
    readonly projectionMs?: number
    readonly filesTraversed?: number
    readonly bytesTraversed?: number
    readonly bytesRead?: number
    readonly bytesHashed?: number
  }) => void
}

/** Use immutable Git blobs for a clean source-cold corpus; retain the canonical scanner otherwise. */
export function createGitRepositoryInventory(
  options: GitRepositoryInventoryOptions,
): typeof inventoryRepository {
  const root = resolve(options.root)
  const fallback = createNodeRepositoryInventory(options)
  const proof = options.proof ?? createGitSourceProofProvider()
  const git = captureGitExecutable()
  const inventory = options.inventory ?? inventoryRepository
  return async (request) => {
    if (resolve(request.root) !== root || request.scanner || request.classifiers) {
      return fallback(request)
    }
    const started = performance.now()
    const stagedInventory = inventoryGitHead(git, root, request, inventory).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    try {
      const proofStarted = performance.now()
      const admitted = await proof.admit(
        root,
        {
          version: 'application-source-scope/1',
          exclude: request.scope?.exclude ?? [],
          ignored: 'reject-semantic',
        },
        request.signal,
      )
      const proofMs = performance.now() - proofStarted
      if (!admitted.ok || admitted.proof.overlay.length) {
        return fallback(request).then((canonical) => {
          observeDecision(options, {
            outcome: 'fallback',
            code: admitted.ok ? 'dirty-worktree' : admitted.code,
            durationMs: performance.now() - started,
            proofMs,
            ...inventoryWork(canonical),
          })
          return canonical
        })
      }
      const staged = await stagedInventory
      if (!staged.ok) throw staged.error
      if (staged.value.headTree !== admitted.proof.headTree) {
        throw new Error('Git HEAD changed during inventory admission.')
      }
      const materialized = staged.value
      for (const source of materialized.sourceTexts) {
        seedOperationSourceText(resolve(root, source.path), {
          text: source.text,
          bytes: source.bytes,
          digest: source.digest,
        })
      }
      observeDecision(options, {
        outcome: 'used',
        code: 'clean-git-tree',
        durationMs: performance.now() - started,
        proofMs,
        treeMs: materialized.treeMs,
        blobsMs: materialized.blobsMs,
        projectionMs: materialized.projectionMs,
        filesTraversed: materialized.filesTraversed,
        bytesTraversed: materialized.bytesTraversed,
        bytesRead: materialized.bytesRead,
        bytesHashed: materialized.bytesHashed,
      })
      return bindDirectoryTopology(materialized.inventory, admitted.proof.topologyDigest)
    } catch (error) {
      request.signal?.throwIfAborted()
      return fallback(request).then((canonical) => {
        observeDecision(options, {
          outcome: 'fallback',
          code: error instanceof Error ? error.name : 'git-inventory-failed',
          durationMs: performance.now() - started,
          ...inventoryWork(canonical),
        })
        return canonical
      })
    }
  }
}

function inventoryWork(inventory: RepositoryInventory) {
  const bytes = inventory.files.reduce((total, file) => total + file.bytes, 0)
  return {
    filesTraversed: inventory.files.length,
    bytesTraversed: bytes,
    bytesRead: bytes,
    bytesHashed: bytes,
  }
}

function observeDecision(
  options: GitRepositoryInventoryOptions,
  decision: Parameters<NonNullable<GitRepositoryInventoryOptions['onDecision']>>[0],
): void {
  try {
    options.onDecision?.(decision)
  } catch {
    // Diagnostic observation cannot change inventory semantics.
  }
}

/** Bind Node application inventory identity to relevant directories as well as regular files. */
export function createNodeRepositoryInventory(
  options: NodeRepositoryInventoryOptions,
): typeof inventoryRepository {
  const root = resolve(options.root)
  const fallback = options.inventory ?? inventoryRepository
  return async (request) => {
    const inventory = await fallback(request)
    if (resolve(request.root) !== root || request.scanner || request.classifiers) return inventory
    const topology = await repositoryDirectoryTopologyFingerprint(
      root,
      request.scope?.exclude ?? [],
      request.signal,
    )
    return bindDirectoryTopology(inventory, topology)
  }
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
    let topology: string
    try {
      const directories: string[] = []
      metadata = await scanMetadata(root, '', request.scope?.exclude ?? [], directories, request.signal)
      topology = digestJson(directories)
    } catch {
      return fallback(request)
    }
    const metadataFingerprint = digestJson({ files: metadata, topology })
    let previous =
      retained?.repository === request.repository && retained.scope === scopeFingerprint
        ? retained
        : undefined
    if (previous?.metadata === metadataFingerprint) {
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
          loaded.manifest.payload.scope === scopeFingerprint &&
          loaded.manifest.payload.encoding === WORKSPACE_CHECKPOINT_JSON_ENCODING
        ) {
          const inventoryBytes = loaded.artifacts.get(INVENTORY)
          const entriesBytes = loaded.artifacts.get(ENTRIES)
          if (inventoryBytes && entriesBytes) {
            const inventoryArtifact = decodeWorkspaceCheckpointJson(inventoryBytes, {
              maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
            })
            const entriesArtifact = decodeWorkspaceCheckpointJson(entriesBytes, {
              maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
            })
            const decodedBytes = inventoryArtifact.decodedBytes + entriesArtifact.decodedBytes
            const inventory = inventoryArtifact.value as RepositoryInventory
            const entriesValue = entriesArtifact.value
            if (
              inventory.repository === request.repository &&
              typeof inventory.revision === 'string' &&
              loaded.manifest.payload.inventory === inventory.revision &&
              loaded.manifest.payload.decodedBytes === decodedBytes &&
              Array.isArray(inventory.files) &&
              isCachedEntries(entriesValue)
            ) {
              previous = {
                repository: request.repository,
                scope: scopeFingerprint,
                metadata: String(loaded.manifest.payload.metadata),
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
      inventory = bindDirectoryTopology(
        await fallback({
          ...request,
          scanner: scanner(entries),
        }),
        topology,
      )
    } catch {
      return bindDirectoryTopology(await fallback(request), topology)
    }
    retained = {
      repository: request.repository,
      scope: scopeFingerprint,
      metadata: metadataFingerprint,
      inventory,
      entries,
    }
    try {
      const inventoryArtifact = encodeWorkspaceCheckpointJson(inventory, {
        maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
      })
      const entriesArtifact = encodeWorkspaceCheckpointJson(entries, {
        maximumDecodedBytes: MAXIMUM_DECODED_ARTIFACT_BYTES,
      })
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
              encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
              decodedBytes: inventoryArtifact.decodedBytes + entriesArtifact.decodedBytes,
            },
          },
          artifacts: {
            [INVENTORY]: inventoryArtifact.value,
            [ENTRIES]: entriesArtifact.value,
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
  readonly metadata: string
  readonly inventory: RepositoryInventory
  readonly entries: readonly CachedRepositoryEntry[]
}

function bindDirectoryTopology(
  inventory: RepositoryInventory,
  topology: string,
): RepositoryInventory {
  return {
    ...inventory,
    revision: deriveAnalysisId('source-manifest', 'astrale.node-repository-inventory', {
      files: inventory.revision,
      directories: topology,
    }) as SourceManifestId,
  }
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
  directories: string[],
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
    if (path === '.git' || path.startsWith('.git/')) continue
    if (entry.isDirectory()) {
      if (repositoryDirectoryExcluded(path, exclude)) continue
      directories.push(path)
      files.push(...(await scanMetadata(root, path, exclude, directories, signal)))
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

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function signalOptions(request: RepositoryInventoryOptions): { readonly signal?: AbortSignal } {
  return request.signal ? { signal: request.signal } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

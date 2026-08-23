import { isUtf8 } from 'node:buffer'
import { createHash } from 'node:crypto'

import type {
  RepositoryInventory,
  RepositoryInventoryOptions,
  RepositoryScanEntry,
  RepositoryScanner,
  SourceProof,
} from '../../repository/index.ts'
import type { GitExecutable } from './source-proof.ts'

import { gitSourcePath } from './source-proof.ts'

interface GitTreeEntry {
  readonly oid: string
  readonly bytes: number
  readonly path: string
}

interface GitSourceText {
  readonly path: string
  readonly text: string
  readonly bytes: number
  readonly digest: string
}

interface GitScannedEntry extends RepositoryScanEntry {
  readonly admittedText?: GitSourceText
}

/** Materialize an exact canonical inventory from one already-admitted immutable Git tree. */
export async function inventoryGitTree(
  git: GitExecutable,
  root: string,
  proof: Pick<SourceProof, 'headTree' | 'overlay'>,
  request: RepositoryInventoryOptions,
  inventory: (options: RepositoryInventoryOptions) => Promise<RepositoryInventory>,
): Promise<{
  readonly inventory: RepositoryInventory
  readonly treeMs: number
  readonly blobsMs: number
  readonly projectionMs: number
  readonly filesTraversed: number
  readonly bytesTraversed: number
  readonly bytesRead: number
  readonly bytesHashed: number
  readonly sourceTexts: readonly GitSourceText[]
}> {
  if (proof.overlay.length) throw new Error('Git tree inventory requires a clean source proof.')
  request.signal?.throwIfAborted()
  let started = performance.now()
  const tree = await git.run(root, ['ls-tree', '-r', '-z', '-l', proof.headTree], request.signal)
  const entries = parseTree(tree)
  const treeMs = performance.now() - started
  started = performance.now()
  const blobs = await git.run(
    root,
    ['cat-file', '--batch'],
    request.signal,
    Buffer.from(entries.map(({ oid }) => `${oid}\n`).join(''), 'ascii'),
  )
  const scanned = parseBlobs(blobs, entries, request.signal)
  const blobsMs = performance.now() - started
  started = performance.now()
  const result = await inventory({ ...request, scanner: scanner(scanned) })
  return {
    inventory: result,
    treeMs,
    blobsMs,
    projectionMs: performance.now() - started,
    filesTraversed: entries.length,
    bytesTraversed: entries.reduce((total, entry) => total + entry.bytes, 0),
    bytesRead: tree.byteLength + blobs.byteLength,
    bytesHashed: entries.reduce((total, entry) => total + entry.bytes, 0),
    sourceTexts: scanned.flatMap((entry) =>
      entry.admittedText ? [entry.admittedText] : [],
    ),
  }
}

/** Resolve and materialize one immutable HEAD tree while clean-worktree admission runs. */
export async function inventoryGitHead(
  git: GitExecutable,
  root: string,
  request: RepositoryInventoryOptions,
  inventory: (options: RepositoryInventoryOptions) => Promise<RepositoryInventory>,
): Promise<Awaited<ReturnType<typeof inventoryGitTree>> & { readonly headTree: string }> {
  const identity = (await git.run(root, ['rev-parse', 'HEAD^{tree}'], request.signal)).toString('ascii').trim()
  if (!/^[0-9a-f]{40,64}$/u.test(identity)) throw new Error('Git HEAD tree identity is invalid.')
  const materialized = await inventoryGitTree(
    git, root, { headTree: identity, overlay: [] }, request, inventory,
  )
  return { ...materialized, headTree: identity }
}

function parseTree(bytes: Uint8Array): readonly GitTreeEntry[] {
  const records = nulRecords(bytes)
  const entries: GitTreeEntry[] = []
  for (const recordBytes of records) {
    const record = fatalText(recordBytes)
    const tab = record.indexOf('\t')
    if (tab < 0) throw new Error('Git tree record has no path delimiter.')
    const header = record.slice(0, tab)
    const match = /^(100644|100755) blob ([0-9a-f]{40,64}) +(\d+)$/u.exec(header)
    // The canonical filesystem scanner ignores symbolic links, submodules, and special entries.
    if (!match) continue
    const path = gitSourcePath(record.slice(tab + 1))
    const size = Number(match[3])
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Git tree size is invalid.')
    entries.push({ oid: match[2]!, bytes: size, path })
  }
  return entries
}

function parseBlobs(
  input: Uint8Array,
  entries: readonly GitTreeEntry[],
  signal?: AbortSignal,
): readonly GitScannedEntry[] {
  const bytes = Buffer.from(input)
  const output: GitScannedEntry[] = []
  let offset = 0
  for (const entry of entries) {
    signal?.throwIfAborted()
    const newline = bytes.indexOf(0x0a, offset)
    if (newline < 0) throw new Error('Git blob response is truncated.')
    const header = bytes.subarray(offset, newline).toString('ascii')
    const match = /^([0-9a-f]{40,64}) blob (\d+)$/u.exec(header)
    if (!match || match[1] !== entry.oid || Number(match[2]) !== entry.bytes) {
      throw new Error(`Git blob identity is inconsistent for ${entry.path}.`)
    }
    const start = newline + 1
    const end = start + entry.bytes
    if (end >= bytes.length || bytes[end] !== 0x0a) {
      throw new Error(`Git blob content is truncated for ${entry.path}.`)
    }
    const content = bytes.subarray(start, end)
    const digest = createHash('sha256').update(content).digest('hex')
    const text = isUtf8(content) ? fatalText(content) : undefined
    output.push({
      path: entry.path,
      bytes: entry.bytes,
      digest,
      content: text === undefined ? 'binary' : 'text',
      ...(text === undefined
        ? {}
        : { admittedText: { path: entry.path, text, bytes: entry.bytes, digest } }),
    })
    offset = end + 1
  }
  if (offset !== bytes.length) throw new Error('Git blob response contains trailing output.')
  return output
}

function scanner(entries: readonly RepositoryScanEntry[]): RepositoryScanner {
  return {
    async scanAll() {
      return entries
    },
    async *scan() {
      for (const entry of entries) yield entry
    },
  }
}

function nulRecords(input: Uint8Array): readonly Buffer[] {
  const bytes = Buffer.from(input)
  const records: Buffer[] = []
  let start = 0
  for (let end = bytes.indexOf(0, start); end >= 0; end = bytes.indexOf(0, start)) {
    records.push(bytes.subarray(start, end))
    start = end + 1
  }
  if (start !== bytes.length) throw new Error('Git tree output is truncated.')
  return records
}

function fatalText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

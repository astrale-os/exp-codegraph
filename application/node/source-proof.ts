import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, type BigIntStats } from 'node:fs'
import { lstat, open, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

import type {
  SourceProofAdmission,
  SourceProofFallbackCode,
  SourceProofOverlayEntry,
  SourceProofProvider,
  SourceScope,
} from '../../repository/index.ts'
import { createSourceProof } from '../../repository/index.ts'
import {
  repositoryDirectoryExcluded,
  repositoryDirectoryTopologyFingerprint,
} from './topology.ts'

const MAXIMUM_GIT_OUTPUT_BYTES = 64 * 1024 * 1024
const MAXIMUM_GIT_ERROR_BYTES = 1024 * 1024
const DIRTY_DIGEST_DOMAIN = 'astrale.codegraph.dirty-source\0'

export interface GitExecutable {
  run(
    root: string, args: readonly string[], signal?: AbortSignal, input?: Uint8Array,
  ): Promise<Buffer>
}

/** Capture the installed Git executable behind one receiver-bound provider. */
export function createGitSourceProofProvider(): SourceProofProvider {
  const git = captureGitExecutable()
  return Object.freeze({
    async admit(root: string, scope: SourceScope, signal?: AbortSignal) {
      const first = await admitGitSourceProof(git, root, scope, signal)
      if (first.ok || first.code !== 'proof-unstable') return first
      return admitGitSourceProof(git, root, scope, signal)
    },
  })
}

async function admitGitSourceProof(
  git: GitExecutable,
  inputRoot: string,
  scope: SourceScope,
  signal?: AbortSignal,
): Promise<SourceProofAdmission> {
  try {
    signal?.throwIfAborted()
    const root = await realpath(resolve(inputRoot))
    const identity = lines(
      await git.run(
        root,
        [
          'rev-parse',
          '--path-format=absolute',
          '--show-toplevel',
          '--show-object-format',
          'HEAD^{tree}',
        ],
        signal,
      ),
    )
    if (identity.length !== 3) {
      return fallback('proof-unsupported', 'Git repository identity is incomplete.')
    }
    const [topLevel, objectFormat, headTree] = identity
    if (
      (await realpath(topLevel!)) !== root ||
      !/^[a-z0-9][a-z0-9-]*$/u.test(objectFormat!) ||
      !/^[0-9a-f]{40,64}$/u.test(headTree!)
    ) {
      return fallback('proof-unsupported', 'Git repository identity is unsupported.')
    }
    const [repositoryFormatBytes, sparseBytes, status, ignored, topologyDigest] = await Promise.all([
      git.run(
        root,
        ['config', '--type=int', '--default=0', '--get', 'core.repositoryformatversion'],
        signal,
      ),
      git.run(
        root,
        ['config', '--type=bool', '--default=false', '--get', 'core.sparseCheckout'],
        signal,
      ),
      git.run(
        root,
        [
          'status',
          '--porcelain=v2',
          '-z',
          '--untracked-files=all',
          '--ignore-submodules=none',
          '--no-renames',
        ],
        signal,
      ),
      git.run(
        root,
        ['ls-files', '--others', '-i', '--exclude-standard', '--directory', '-z'],
        signal,
      ),
      repositoryDirectoryTopologyFingerprint(root, scope.exclude, signal),
    ])
    const repositoryFormat = text(repositoryFormatBytes).trim()
    if (!/^\d+$/u.test(repositoryFormat)) {
      return fallback('proof-unsupported', 'Git repository format is unsupported.')
    }
    if (text(sparseBytes).trim() !== 'false') {
      return fallback('proof-unsupported', 'Sparse Git worktrees require complete scanning.')
    }
    const semanticIgnored = nulStrings(ignored).filter((path) => gitSourcePathIncluded(path, scope))
    if (semanticIgnored.length) {
      return fallback(
        'proof-unsupported',
        `Semantic source paths are ignored by Git: ${semanticIgnored.slice(0, 3).join(', ')}`,
      )
    }
    const candidates = parseStatus(status, scope)
    if (!candidates.ok) return candidates.admission
    const overlay: SourceProofOverlayEntry[] = []
    for (const candidate of candidates.values) {
      signal?.throwIfAborted()
      overlay.push(await dirtyOverlayEntry(root, candidate, signal))
    }
    return {
      ok: true,
      proof: createSourceProof({
        format: 'astrale.codegraph.source-proof',
        version: 1,
        repositoryFormat,
        objectFormat: objectFormat!,
        headTree: headTree!,
        topologyDigest,
        scope,
        overlay,
        changedPaths: overlay.map((entry) => entry.path),
      }),
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof SourceProofError) {
      return fallback(error.code, error.message, error.code === 'proof-unstable')
    }
    if (unreadable(error)) {
      return fallback(
        'proof-unreadable',
        `Git source proof cannot read a semantic input: ${boundedMessage(error)}`,
      )
    }
    return fallback(
      'proof-unsupported',
      `Git source proof is unavailable: ${boundedMessage(error)}`,
    )
  }
}

interface DirtyCandidate {
  readonly path: string
  readonly previousMode: string
}

type ParsedStatus =
  | { readonly ok: true; readonly values: readonly DirtyCandidate[] }
  | { readonly ok: false; readonly admission: SourceProofAdmission }

function parseStatus(bytes: Uint8Array, scope: SourceScope): ParsedStatus {
  const records = nulBuffers(bytes)
  const values = new Map<string, DirtyCandidate>()
  for (let index = 0; index < records.length; index += 1) {
    const record = fatalText(records[index]!)
    if (!record) continue
    const kind = record[0]
    if (kind === 'u') {
      return rejectedStatus('proof-conflict', 'Git worktree contains unresolved conflicts.')
    }
    if (kind === '1') {
      const parsed = fixedRecord(record, 8)
      if (!parsed || parsed.fields[2]?.startsWith('S')) {
        return rejectedStatus('proof-unsupported', 'Git status record is unsupported.')
      }
      rememberCandidate(values, parsed.path, parsed.fields[3]!, scope)
      continue
    }
    if (kind === '2') {
      const parsed = fixedRecord(record, 9)
      const previous = records[++index]
      if (!parsed || !previous || parsed.fields[2]?.startsWith('S')) {
        return rejectedStatus('proof-unsupported', 'Git rename record is incomplete.')
      }
      rememberCandidate(values, parsed.path, parsed.fields[3]!, scope)
      rememberCandidate(values, fatalText(previous), parsed.fields[3]!, scope)
      continue
    }
    if (kind === '?') {
      rememberCandidate(values, record.slice(2), '000000', scope)
      continue
    }
    return rejectedStatus('proof-unsupported', 'Git status record is unsupported.')
  }
  return {
    ok: true,
    values: [...values.values()].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

function rejectedStatus(code: SourceProofFallbackCode, message: string): ParsedStatus {
  return { ok: false, admission: fallback(code, message) }
}

function rememberCandidate(
  values: Map<string, DirtyCandidate>,
  input: string,
  previousMode: string,
  scope: SourceScope,
): void {
  const path = gitSourcePath(input)
  if (gitSourcePathIncluded(path, scope)) values.set(path, { path, previousMode })
}

async function dirtyOverlayEntry(
  root: string,
  candidate: DirtyCandidate,
  signal?: AbortSignal,
): Promise<SourceProofOverlayEntry> {
  const file = join(root, ...candidate.path.split('/'))
  let before: BigIntStats
  try {
    before = await lstat(file, { bigint: true })
  } catch (error) {
    if (missing(error)) {
      return { path: candidate.path, kind: 'deletion', previousMode: candidate.previousMode }
    }
    throw new SourceProofError('proof-unreadable', `Dirty source cannot be read: ${candidate.path}`)
  }
  signal?.throwIfAborted()
  if (before.isSymbolicLink()) {
    const target = await readlink(file, 'buffer')
    signal?.throwIfAborted()
    const after = await lstat(file, { bigint: true })
    if (!sameMetadata(before, after)) {
      throw new SourceProofError(
        'proof-unstable',
        `Dirty source changed during admission: ${candidate.path}`,
      )
    }
    return {
      path: candidate.path,
      kind: 'content',
      content: 'symlink',
      mode: '120000',
      bytes: target.byteLength,
      digest: dirtyDigest(target),
    }
  }
  if (!before.isFile()) {
    throw new SourceProofError(
      'proof-unsupported',
      `Dirty source has an unsupported type: ${candidate.path}`,
    )
  }
  const handle = await open(file, 'r')
  try {
    const opened = await handle.stat({ bigint: true })
    if (!sameMetadata(before, opened)) {
      throw new SourceProofError(
        'proof-unstable',
        `Dirty source changed before admission: ${candidate.path}`,
      )
    }
    const digest = createHash('sha256').update(DIRTY_DIGEST_DOMAIN)
    let bytes = 0
    const stream = createReadStream(file, { fd: handle.fd, autoClose: false, signal })
    for await (const chunk of stream) {
      const value = Buffer.from(chunk)
      bytes += value.byteLength
      digest.update(value)
    }
    const closed = await handle.stat({ bigint: true })
    const pathAfter = await lstat(file, { bigint: true })
    if (
      !sameMetadata(opened, closed) ||
      !sameMetadata(opened, pathAfter) ||
      bytes !== Number(closed.size)
    ) {
      throw new SourceProofError(
        'proof-unstable',
        `Dirty source changed during admission: ${candidate.path}`,
      )
    }
    return {
      path: candidate.path,
      kind: 'content',
      content: 'file',
      mode: (Number(closed.mode) & 0o111) === 0 ? '100644' : '100755',
      bytes,
      digest: digest.digest('hex'),
    }
  } finally {
    await handle.close()
  }
}

export function captureGitExecutable(): GitExecutable {
  const execute = spawn
  return Object.freeze({
    run(root: string, args: readonly string[], signal?: AbortSignal, input?: Uint8Array) {
      return new Promise<Buffer>((resolveResult, reject) => {
        signal?.throwIfAborted()
        const child = execute('git', ['-C', root, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let stdoutBytes = 0
        let stderrBytes = 0
        let settled = false
        const finish = (operation: () => void): void => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', abort)
          operation()
        }
        const abort = (): void => {
          child.kill('SIGKILL')
          finish(() => reject(signal?.reason ?? new DOMException('Operation aborted.', 'AbortError')))
        }
        const abortWithError = (message: string): void => {
          child.kill('SIGKILL')
          finish(() => reject(new Error(message)))
        }
        signal?.addEventListener('abort', abort, { once: true })
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.byteLength
          if (stdoutBytes > MAXIMUM_GIT_OUTPUT_BYTES) abortWithError('Git output exceeded its bound.')
          else stdout.push(chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderrBytes += chunk.byteLength
          if (stderrBytes > MAXIMUM_GIT_ERROR_BYTES) abortWithError('Git error output exceeded its bound.')
          else stderr.push(chunk)
        })
        child.on('error', (error) => finish(() => reject(error)))
        child.on('close', (code, childSignal) => {
          if (settled) return
          if (code === 0) finish(() => resolveResult(Buffer.concat(stdout, stdoutBytes)))
          else {
            const detail = Buffer.concat(stderr, stderrBytes).toString('utf8').trim()
            finish(() =>
              reject(
                new Error(
                  `git exited with ${childSignal ?? code}: ${detail || 'no diagnostic'}`,
                ),
              ),
            )
          }
        })
        child.stdin.end(input)
      })
    },
  })
}

function fixedRecord(
  record: string,
  fields: number,
): { readonly fields: readonly string[]; readonly path: string } | undefined {
  const values: string[] = []
  let start = 0
  for (let index = 0; index < fields; index += 1) {
    const end = record.indexOf(' ', start)
    if (end < 0) return undefined
    values.push(record.slice(start, end))
    start = end + 1
  }
  if (start >= record.length) return undefined
  return { fields: values, path: record.slice(start) }
}

export function gitSourcePath(input: string): string {
  if (!input || input.includes('\0') || isAbsolute(input)) {
    throw new SourceProofError('proof-unsupported', 'Git returned an invalid source path.')
  }
  const path = sep === '/' ? input : input.split(sep).join('/')
  if (path === '..' || path.startsWith('../') || path.includes('/../')) {
    throw new SourceProofError('proof-unsupported', 'Git source path escapes the repository.')
  }
  return path
}

export function gitSourcePathIncluded(path: string, scope: SourceScope): boolean {
  const patterns = sep === '/'
    ? scope.exclude
    : scope.exclude.map((value) => value.split(sep).join('/'))
  return !repositoryDirectoryExcluded(path, patterns)
}

function dirtyDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(DIRTY_DIGEST_DOMAIN).update(bytes).digest('hex')
}

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function nulBuffers(bytes: Uint8Array): readonly Buffer[] {
  const value = Buffer.from(bytes)
  const records: Buffer[] = []
  let start = 0
  for (let end = value.indexOf(0, start); end >= 0; end = value.indexOf(0, start)) {
    records.push(value.subarray(start, end))
    start = end + 1
  }
  if (start < value.length) {
    throw new SourceProofError('proof-unsupported', 'Git -z output is truncated.')
  }
  return records
}

function nulStrings(bytes: Uint8Array): readonly string[] {
  return nulBuffers(bytes).map(fatalText).map(gitSourcePath)
}

function fatalText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SourceProofError('proof-unsupported', 'Git returned a non-UTF-8 source path.')
  }
}

function text(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SourceProofError('proof-unsupported', 'Git returned invalid UTF-8 output.')
  }
}

function lines(bytes: Uint8Array): readonly string[] {
  return text(bytes).trim().split(/\r?\n/u)
}

function fallback(code: SourceProofFallbackCode, message: string, retryable = false):
Extract<SourceProofAdmission, { readonly ok: false }> {
  return { ok: false, code, message, retryable }
}

class SourceProofError extends Error {
  readonly code: SourceProofFallbackCode
  constructor(code: SourceProofFallbackCode, message: string) {
    super(message)
    this.name = 'SourceProofError'
    this.code = code
  }
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function unreadable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error &&
      (error.code === 'EACCES' || error.code === 'EPERM')) return true
  return /permission denied|operation not permitted/iu.test(
    error instanceof Error ? error.message : String(error),
  )
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 500 ? message : `${message.slice(0, 500)}…`
}

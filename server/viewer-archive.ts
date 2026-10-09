import { createHash } from 'node:crypto'
import { constants, createReadStream, read } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

interface ArchiveEntry { readonly offset: number; readonly bytes: number }

/** One admitted inode owns every response, even while a cache entry is repaired. */
export interface ViewerArchive {
  bytes(path: string): number | undefined
  stream(path: string): Readable
  close(): Promise<void>
}

export const MAX_VIEWER_ARCHIVE_BYTES = 256 * 1024 * 1024
const BLOCK = 512
const MAX_ENTRIES = 16_384

/** The producer writes a deliberately narrow ustar: sorted, regular files only. */
export async function openViewerArchive(path: string, expected: { bytes: number; sha256: string }): Promise<ViewerArchive> {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < BLOCK * 2 || expected.bytes > MAX_VIEWER_ARCHIVE_BYTES || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new Error('Invalid viewer archive identity.')
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size !== expected.bytes || metadata.size % BLOCK !== 0) throw new Error('Viewer archive size does not match its release.')
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(512 * 1024)
    for (let position = 0; position < metadata.size;) {
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, metadata.size - position), position)
      if (!bytesRead) throw new Error('Truncated viewer archive.')
      hash.update(chunk.subarray(0, bytesRead))
      position += bytesRead
    }
    if (hash.digest('hex') !== expected.sha256) throw new Error('Viewer archive digest does not match its release.')
    const entries = await indexArchive(file, metadata.size)
    const streams = new Set<Readable>()
    let closing: Promise<void> | undefined
    return {
      bytes: (path) => entries.get(path)?.bytes,
      stream(path) {
        if (closing) throw new Error('Viewer archive is closed.')
        const entry = entries.get(path)
        if (!entry) throw new Error('Viewer asset is unavailable.')
        // end is inclusive; a zero-length entry is represented without reading the next header.
        const stream = entry.bytes ? createReadStream('', {
          fd: file.fd, start: entry.offset, end: entry.offset + entry.bytes - 1, autoClose: false,
          // destroy() closes even a stream with autoClose:false. Responses own their read
          // operation, while the archive owner alone closes this shared descriptor.
          fs: { read, close(_fd, done) { done(null) } },
        }) : Readable.from([])
        streams.add(stream)
        stream.once('close', () => streams.delete(stream))
        stream.once('end', () => streams.delete(stream))
        return stream
      },
      close() {
        return closing ??= (async () => {
          const active = [...streams]
          for (const stream of active) stream.destroy()
          await Promise.all(active.map((stream) => finished(stream).catch(() => undefined)))
          await file.close()
        })()
      },
    }
  } catch (error) {
    await file.close()
    throw error
  }
}

async function indexArchive(file: FileHandle, bytes: number): Promise<ReadonlyMap<string, ArchiveEntry>> {
  const entries = new Map<string, ArchiveEntry>()
  let position = 0
  let previous = ''
  while (position + BLOCK * 2 <= bytes) {
    const header = await readBlock(file, position)
    if (header.every((byte) => byte === 0)) {
      if (position + BLOCK * 2 !== bytes || !(await readBlock(file, position + BLOCK)).every((byte) => byte === 0)) throw new Error('Invalid viewer archive terminator.')
      for (const required of ['index.html', 'THIRD_PARTY_NOTICES.txt', 'viewer-build.json']) {
        if (!entries.get(required)?.bytes) throw new Error(`Viewer archive is missing ${required}.`)
      }
      return entries
    }
    if (entries.size >= MAX_ENTRIES || header.toString('ascii', 257, 263) !== 'ustar\0' || header.toString('ascii', 263, 265) !== '00' || header[156] !== 48) throw new Error('Unsupported viewer archive entry.')
    let checksum = 0
    for (let index = 0; index < BLOCK; index++) checksum += index >= 148 && index < 156 ? 32 : header[index]!
    if (checksum !== octal(header, 148, 8)) throw new Error('Invalid viewer archive header checksum.')
    if (field(header, 157, 100) !== '' || field(header, 345, 155) !== '') throw new Error('Viewer archive links and path prefixes are unsupported.')
    const path = field(header, 0, 100)
    if (!/^[\x20-\x7e]+$/.test(path) || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..') || path <= previous) throw new Error('Invalid or duplicated viewer asset path.')
    const size = octal(header, 124, 12)
    const offset = position + BLOCK
    const next = offset + Math.ceil(size / BLOCK) * BLOCK
    if (!Number.isSafeInteger(next) || next + BLOCK * 2 > bytes) throw new Error('Viewer asset exceeds its archive.')
    const padding = next - offset - size
    if (padding) {
      const buffer = Buffer.alloc(padding)
      const { bytesRead } = await file.read(buffer, 0, padding, offset + size)
      if (bytesRead !== padding || !buffer.every((byte) => byte === 0)) throw new Error('Invalid viewer archive padding.')
    }
    entries.set(path, Object.freeze({ offset, bytes: size }))
    previous = path
    position = next
  }
  throw new Error('Truncated viewer archive terminator.')
}

async function readBlock(file: FileHandle, position: number): Promise<Buffer> {
  const block = Buffer.alloc(BLOCK)
  const { bytesRead } = await file.read(block, 0, BLOCK, position)
  if (bytesRead !== BLOCK) throw new Error('Truncated viewer archive header.')
  return block
}

function field(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length)
  const end = bytes.indexOf(0)
  if (end !== -1 && !bytes.subarray(end).every((byte) => byte === 0)) throw new Error('Invalid viewer archive field.')
  if (!bytes.subarray(0, end === -1 ? length : end).every((byte) => byte >= 32 && byte <= 126)) throw new Error('Invalid viewer archive text.')
  return bytes.toString('ascii', 0, end === -1 ? length : end)
}

function octal(header: Buffer, start: number, length: number): number {
  const text = header.toString('ascii', start, start + length)
  if (!/^[0-7]+[\0 ]*$/.test(text)) throw new Error('Invalid viewer archive numeric field.')
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid viewer archive numeric value.')
  return value
}

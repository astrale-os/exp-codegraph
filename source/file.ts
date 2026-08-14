import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, rename, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

export type ReplaceBoundedResult =
  | { status: 'saved'; revision: string }
  | { status: 'conflict'; revision: string }

export async function readBytesBounded(
  file: string,
  maximumBytes: number = MAX_FILE_BYTES,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error('maximumBytes must be a non-negative safe integer.')
  }
  const handle = await openDirectFile(file)
  try {
    const chunks: Buffer[] = []
    let size = 0
    while (size <= maximumBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - size))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length)
      if (!bytesRead) break
      chunks.push(chunk.subarray(0, bytesRead))
      size += bytesRead
    }
    if (size > maximumBytes) throw new Error(`File exceeds ${maximumBytes} bytes.`)
    return Buffer.concat(chunks, size)
  } finally {
    await handle.close()
  }
}

export async function readBounded(
  file: string,
  maximumBytes: number = MAX_FILE_BYTES,
): Promise<string> {
  const bytes = await readBytesBounded(file, maximumBytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof TypeError) throw new Error('File is not valid UTF-8.', { cause: error })
    throw error
  }
}

export async function optionalDirectFile(file: string): Promise<boolean> {
  try {
    const handle = await openDirectFile(file)
    await handle.close()
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

export function sourceRevision(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function replaceBounded(
  file: string,
  text: string,
  expectedRevision: string,
): Promise<ReplaceBoundedResult> {
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes.`)
  }

  const current = await readBounded(file)
  const revision = sourceRevision(current)
  if (revision !== expectedRevision) return { status: 'conflict', revision }

  const before = await lstat(file)
  if (before.isSymbolicLink()) throw new Error('Symbolic links are not supported.')
  if (!before.isFile()) throw new Error('Path must be a regular file.')

  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: before.mode & 0o777 })
    const latest = await readBounded(file)
    const latestRevision = sourceRevision(latest)
    if (latestRevision !== expectedRevision) {
      return { status: 'conflict', revision: latestRevision }
    }
    await rename(temporary, file)
    return { status: 'saved', revision: sourceRevision(text) }
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function openDirectFile(file: string): Promise<FileHandle> {
  const before = await lstat(file)
  if (before.isSymbolicLink()) throw new Error('Symbolic links are not supported.')
  if (!before.isFile()) throw new Error('Path must be a regular file.')

  const handle = await open(file, 'r')
  const after = await handle.stat()
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
    await handle.close()
    throw new Error('File changed while it was opened.')
  }
  return handle
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

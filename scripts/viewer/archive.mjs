import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Deterministic, file-only ustar; no extraction or archive library is required at runtime. */
export async function buildViewerArchive(root) {
  const files = await inventory(root)
  if (files.length > 16_384) throw new Error('Viewer archive exceeds its runtime entry bound.')
  for (const required of ['index.html', 'THIRD_PARTY_NOTICES.txt', 'viewer-build.json']) {
    if (!files.includes(required)) throw new Error(`Viewer build is missing ${required}.`)
  }
  const parts = []
  for (const path of files.sort()) {
    if (!/^[\x20-\x7e]+$/.test(path) || path.includes('\\') || Buffer.byteLength(path) > 100 || path.split('/').some((part) => !part || part === '.' || part === '..') || path.endsWith('.map')) throw new Error(`Unsupported viewer asset: ${path}`)
    const data = await readFile(join(root, path))
    const header = Buffer.alloc(512)
    header.write(path, 0, 'ascii')
    octal(header, 100, 8, 0o644)
    octal(header, 108, 8, 0)
    octal(header, 116, 8, 0)
    octal(header, 124, 12, data.length)
    octal(header, 136, 12, 0)
    header.fill(32, 148, 156)
    header[156] = 48
    header.write('ustar\0', 257, 'ascii')
    header.write('00', 263, 'ascii')
    octal(header, 329, 8, 0)
    octal(header, 337, 8, 0)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
    parts.push(header, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  const tar = Buffer.concat([...parts, Buffer.alloc(1024)])
  if (tar.length > 256 * 1024 * 1024) throw new Error('Viewer archive exceeds its runtime size bound.')
  const gzip = gzipSync(tar, { level: 9 })
  if (gzip.length > 256 * 1024 * 1024) throw new Error('Encoded viewer archive exceeds its runtime size bound.')
  return { tar, gzip, descriptor: { bytes: tar.length, sha256: digest(tar), compression: { format: 'gzip', bytes: gzip.length, sha256: digest(gzip) } } }
}

async function inventory(root, prefix = '') {
  const files = []
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name
    const metadata = await lstat(join(root, path))
    if (metadata.isDirectory()) files.push(...await inventory(root, path))
    else if (metadata.isFile()) files.push(path)
    else throw new Error(`Viewer asset is not a regular file: ${path}`)
  }
  return files
}

function octal(header, offset, length, value) {
  const text = value.toString(8)
  if (text.length >= length) throw new Error('Viewer ustar numeric field exceeds its width.')
  header.write(text.padStart(length - 1, '0') + '\0', offset, 'ascii')
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }

import { createReadStream, createWriteStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip, createGunzip } from 'node:zlib'
import { digestFile } from './shared.mjs'

/** Gzip is a storage encoding, never a replacement for the compiler's identity. */
export async function encodeNativeExecutable(source, destination, artifact) {
  await mkdir(dirname(destination), { recursive: true })
  const staging = `${destination}.${randomUUID()}.tmp`
  try {
    await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(staging, { flags: 'wx', mode: 0o644 }))
    const compression = { format: 'gzip', path: `${artifact.executable}.gz`, ...await digestFile(staging) }
    await assertDeliveredArtifact(staging, { ...artifact, compression })
    await rename(staging, destination)
    return { ...artifact, compression }
  } finally { await rm(staging, { force: true }) }
}

/** Validate both the packaged encoding and the exact original executable. */
export async function assertDeliveredArtifact(path, artifact) {
  const encoded = artifact.compression ?? artifact
  const actual = await digestFile(path)
  if (actual.bytes !== encoded.bytes || actual.sha256 !== encoded.sha256) throw new Error(`${path} encoded bytes do not match the release manifest.`)
  let bytes = 0
  const hash = createHash('sha256')
  const sink = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length
      if (bytes > artifact.bytes) return done(new Error(`${path} exceeds its qualified original size.`))
      hash.update(chunk)
      done()
    },
  })
  await pipeline(createReadStream(path), ...(artifact.compression ? [createGunzip()] : []), sink)
  if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256) throw new Error(`${path} original bytes do not match the release manifest.`)
}

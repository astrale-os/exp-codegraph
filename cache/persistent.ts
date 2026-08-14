import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { deserialize, serialize } from 'node:v8'
import { gzip, gunzip } from 'node:zlib'

import type { BinaryCacheStore } from './file-store.ts'
import type { RestorableCache } from './memory.ts'

import { record } from './memory.ts'

const compress = promisify(gzip)
const decompress = promisify(gunzip)
const MAX_PARTICIPANT_BYTES = 96 * 1_024 * 1_024

export interface PersistentCacheParticipant {
  readonly name: string
  readonly cache: RestorableCache
}

export interface PersistentCacheSession {
  restore(): Promise<void>
  save(): Promise<void>
}

interface PersistentCacheEnvelope {
  readonly format: string
  readonly scope: string
  readonly entries: ReadonlyMap<string, Uint8Array>
}

/** Persist cache evidence while leaving validity decisions with each owning cache. */
export function createPersistentCacheSession(options: {
  readonly format: string
  readonly scope: string
  readonly store: BinaryCacheStore
  readonly participants: readonly PersistentCacheParticipant[]
}): PersistentCacheSession {
  const participants = new Map(options.participants.map((item) => [item.name, item.cache]))
  let retained = new Map<string, RetainedEntry>()
  if (participants.size !== options.participants.length)
    throw new Error('Persistent cache participant names must be unique.')

  return {
    async restore() {
      const encoded = await options.store.load()
      if (!encoded) return
      try {
        const envelope: unknown = deserialize(encoded)
        if (!validEnvelope(envelope, options.format, options.scope))
          throw new Error('invalid cache')
        let damaged = false
        for (const [name, cache] of participants) {
          const entry = envelope.entries.get(name)
          if (!entry) continue
          try {
            const unpacked = await decompress(entry, { maxOutputLength: MAX_PARTICIPANT_BYTES })
            cache.restore(options.scope, deserialize(unpacked))
            retained.set(name, { identity: contentIdentity(unpacked), entry })
          } catch {
            damaged = true
          }
        }
        if (damaged) await options.store.remove()
      } catch {
        await options.store.remove()
      }
    },
    async save() {
      try {
        const completed: PreparedEntry[] = []
        for (const [name, cache] of participants) {
          try {
            const unpacked = serialize(cache.snapshot(options.scope))
            if (unpacked.byteLength > MAX_PARTICIPANT_BYTES) continue
            const identity = contentIdentity(unpacked)
            const previous = retained.get(name)
            const entry =
              previous?.identity === identity
                ? previous.entry
                : await compress(unpacked, { level: 1 })
            completed.push({ name, identity, entry })
          } catch {
            // One participant never prevents other independent evidence from being retained.
          }
        }
        const entries = new Map(completed.map(({ name, entry }) => [name, entry]))
        const envelope: PersistentCacheEnvelope = {
          format: options.format,
          scope: options.scope,
          entries,
        }
        await options.store.save(serialize(envelope))
        retained = new Map(
          completed.map(({ name, identity, entry }) => [name, { identity, entry }]),
        )
      } catch {
        // Non-serializable or resource-constrained cache evidence is simply not persisted.
      }
    },
  }
}

interface RetainedEntry {
  readonly identity: string
  readonly entry: Uint8Array
}

interface PreparedEntry extends RetainedEntry {
  readonly name: string
}

function contentIdentity(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function validEnvelope(
  value: unknown,
  format: string,
  scope: string,
): value is PersistentCacheEnvelope {
  return (
    record(value) &&
    value.format === format &&
    value.scope === scope &&
    value.entries instanceof Map &&
    [...value.entries].every(
      ([name, entry]) => typeof name === 'string' && entry instanceof Uint8Array,
    )
  )
}

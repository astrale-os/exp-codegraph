import { createHash } from 'node:crypto'

const HASHES = 12
export const COMPUTATION_RECEIPT_BYTES = 512 * 1024
export const COMPUTATION_WITNESS_BYTES = 4096 * Float64Array.BYTES_PER_ELEMENT

/** Only an exact tag match skips hashing; a slot collision records both keys. */
export function recordComputationWitness(tags: Float64Array, identity: number | undefined): boolean {
  if (identity === undefined || !Number.isSafeInteger(identity) || identity <= 0) return true
  const slot = identity & (tags.length - 1)
  if (tags[slot] === identity) return false
  tags[slot] = identity
  return true
}

/** A negative membership answer proves absence; every positive forces a miss. */
export class ComputationReceipt {
  readonly #words: Uint32Array

  constructor(words: Uint32Array = new Uint32Array(COMPUTATION_RECEIPT_BYTES / 4)) { this.#words = words }

  add(key: string): void {
    const digest = hash(key)
    const mask = this.#words.length * 32 - 1
    for (let index = 0; index < HASHES; index++) {
      const bit = digest.readUInt32LE(index * 4) & mask
      this.#words[bit >>> 5]! |= 1 << (bit & 31)
    }
  }

  intersects(keys: Iterable<string>): boolean {
    for (const digest of ComputationReceipt.hashes(keys)) if (this.mayContain(digest)) return true
    return false
  }

  /** Stream one temporary digest across independent receipts without retaining the delta. */
  static *hashes(keys: Iterable<string>): Iterable<Buffer> {
    for (const key of keys) yield hash(key)
  }

  mayContain(digest: Buffer): boolean {
    const mask = this.#words.length * 32 - 1
    for (let index = 0; index < HASHES; index++) {
      const bit = digest.readUInt32LE(index * 4) & mask
      if (!(this.#words[bit >>> 5]! & (1 << (bit & 31)))) return false
    }
    return true
  }

  /** Folding preserves every inserted bit, unlike truncation or resampling. */
  compact(): ComputationReceipt | undefined {
    let words = this.#words
    if (density(words) > 0.5) return
    while (words.byteLength > 1024) {
      const folded = new Uint32Array(words.length / 2)
      for (let index = 0; index < folded.length; index++) folded[index] = words[index]! | words[index + folded.length]!
      if (density(folded) > 0.3) break
      words = folded
    }
    return words === this.#words ? this : new ComputationReceipt(words)
  }

  get bytes(): number { return this.#words.byteLength + 96 }
}

function hash(key: string): Buffer {
  // Exact UTF-16 code units: distinct lone surrogates must not alias through
  // UTF-8 replacement. Collisions may only cause extra work, never stale reuse.
  return createHash('sha512').update(key, 'utf16le').digest()
}

function density(words: Uint32Array): number {
  let bits = 0
  for (let word of words) {
    word -= (word >>> 1) & 0x55555555
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333)
    bits += (((word + (word >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
  }
  return bits / (words.length * 32)
}

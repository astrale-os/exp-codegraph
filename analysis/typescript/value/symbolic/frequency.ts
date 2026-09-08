/** Bounded, aging request counts. Equal-frequency scans do not evict resident work. */
export class RequestFrequency {
  readonly #counts: Uint8Array
  readonly #mask: number
  #samples = 0

  constructor(maximumBytes: number) {
    let width = 1
    while (width < Math.min(16_384, Math.max(1, maximumBytes / 1_024))) width *= 2
    this.#counts = new Uint8Array(width * 4)
    this.#mask = width - 1
  }

  get bytes(): number { return this.#counts.byteLength }

  record(key: string): void {
    const hash = hashKey(key)
    for (let row = 0; row < 4; row++) {
      const index = this.position(hash, row)
      if (this.#counts[index]! < 255) this.#counts[index]!++
    }
    if (++this.#samples >= (this.#mask + 1) * 10) {
      for (let index = 0; index < this.#counts.length; index++) this.#counts[index]! >>>= 1
      this.#samples >>>= 1
    }
  }

  estimate(key: string): number {
    const hash = hashKey(key)
    let count = 255
    for (let row = 0; row < 4; row++) count = Math.min(count, this.#counts[this.position(hash, row)]!)
    return count
  }

  private position(hash: number, row: number): number {
    const stride = (hash >>> 16) | 1
    return row * (this.#mask + 1) + ((hash + Math.imul(row, stride)) & this.#mask)
  }
}

function hashKey(key: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  return (hash ^ (hash >>> 13)) >>> 0
}

import type { EvaluatedValueResult } from '../model.ts'
import { types } from 'node:util'

/** One resident project owns this bounded LRU across every model and budget. */
export class ValueResolutionCache {
  readonly #entries = new Map<string, { result: EvaluatedValueResult<unknown>; bytes: number }>()
  readonly #models = new WeakMap<object, number>()
  readonly #maximumEntries: number
  readonly #maximumBytes: number
  #nextModel = 0
  #bytes = 0
  #closed = false

  constructor(maximumEntries = 1024, maximumBytes = 8 * 1024 * 1024) {
    this.#maximumEntries = maximumEntries
    this.#maximumBytes = maximumBytes
  }

  model(model: object | undefined): number {
    if (!model) return 0
    let id = this.#models.get(model)
    if (id === undefined) this.#models.set(model, (id = ++this.#nextModel))
    return id
  }

  get(key: string, valid: (result: EvaluatedValueResult<unknown>) => boolean): EvaluatedValueResult<unknown> | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return
    this.#entries.delete(key)
    if (!valid(entry.result)) { this.#bytes -= entry.bytes; return }
    this.#entries.set(key, entry)
    return entry.result
  }

  put(key: string, result: EvaluatedValueResult<unknown>, bytes: number): void {
    if (this.#closed) return
    bytes += key.length * 2 + 128
    if (bytes > this.#maximumBytes) return
    const previous = this.#entries.get(key)
    if (previous) { this.#bytes -= previous.bytes; this.#entries.delete(key) }
    this.#entries.set(key, { result, bytes })
    this.#bytes += bytes
    while (this.#entries.size > this.#maximumEntries || this.#bytes > this.#maximumBytes) {
      const oldest = this.#entries.keys().next().value!
      this.#bytes -= this.#entries.get(oldest)!.bytes
      this.#entries.delete(oldest)
    }
  }

  close(): void { this.#closed = true; this.#entries.clear(); this.#bytes = 0 }
  get size(): number { return this.#entries.size }
  get bytes(): number { return this.#bytes }
}

/** Estimate owned storage only for deeply immutable, portable result graphs. */
export function resolutionResultBytes(input: unknown): number | undefined {
  let bytes = 0
  const seen = new Set<object>()
  const inspect = (value: unknown, depth: number): void => {
    if (depth > 128 || bytes > 1024 * 1024) throw undefined
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
      bytes += 16
      return
    }
    if (typeof value === 'string') { bytes += 32 + value.length * 2; return }
    if (typeof value !== 'object' || types.isProxy(value)) throw undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) throw undefined
    // The engine owns the outer receipt and freezes it after attaching metadata.
    // Every nested object, including opaque model atoms, must already be frozen.
    if (depth > 0 && !Object.isFrozen(value)) throw undefined
    if (seen.has(value)) return
    seen.add(value)
    bytes += 64
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!('value' in descriptor)) throw undefined
      bytes += 32 + (typeof key === 'string' ? key.length * 2 : 16)
      inspect(descriptor.value, depth + 1)
    }
  }
  try { inspect(input, 0); return bytes <= 1024 * 1024 ? bytes : undefined }
  catch { return undefined }
}

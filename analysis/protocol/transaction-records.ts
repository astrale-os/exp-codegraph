import type { FactShard, FactShardReference } from '../facts/index.ts'
import type { FactTransaction } from '../generation/index.ts'
import type { FactShardKey } from '../identity/index.ts'

type TransactionHeader = Pick<FactTransaction, 'protocolVersion' | 'base' | 'next'>

interface RecordAdmission {
  header(input: unknown): TransactionHeader
  reference(input: unknown): FactShardReference
  shard(input: unknown): FactShard
  deletion(input: unknown): FactShardKey
}

/**
 * Private wire staging. Complete records are admitted immediately; their encoded
 * bytes are released before the next record. Nothing is published until finish
 * and the enclosing stream's length, order and digest have all been verified.
 */
export class TransactionRecordDecoder {
  readonly #admission: RecordAdmission
  readonly #maximumRecordBytes: number
  readonly #decoder = new TextDecoder('utf8', { fatal: true })
  readonly #manifest: FactShardReference[] = []
  readonly #upserts: FactShard[] = []
  readonly #deletes: FactShardKey[] = []
  #header: TransactionHeader | undefined
  #expected: readonly number[] | undefined
  #recordBytes = 0
  #buffer: Buffer | undefined
  #phase = 0
  #finished = false

  constructor(maximumRecordBytes: number, admission: RecordAdmission) {
    this.#maximumRecordBytes = maximumRecordBytes
    this.#admission = admission
  }

  append(bytes: Uint8Array): void {
    if (this.#finished) throw new TypeError('Transaction record stream is already finished.')
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let start = 0
    for (let index = input.indexOf(10, start); index >= 0; index = input.indexOf(10, start)) {
      const complete = bytes.subarray(start, index)
      if (this.#recordBytes === 0) this.record(complete)
      else {
        this.retain(complete)
        this.record(this.#buffer!.subarray(0, this.#recordBytes))
      }
      start = index + 1
    }
    this.retain(bytes.subarray(start))
  }

  finish(): FactTransaction {
    if (this.#finished) throw new TypeError('Transaction record stream is already finished.')
    this.#finished = true
    if (this.#recordBytes !== 0) throw new TypeError('Transaction record stream is unterminated.')
    const expected = this.#expected
    if (!this.#header || !expected ||
      this.#manifest.length !== expected[0] || this.#upserts.length !== expected[1] ||
      this.#deletes.length !== expected[2]) {
      throw new TypeError('Transaction record stream is incomplete.')
    }
    return { ...this.#header, manifest: this.#manifest, upserts: this.#upserts, deletes: this.#deletes }
  }

  private retain(bytes: Uint8Array): void {
    if (!bytes.length) return
    const length = this.#recordBytes + bytes.length
    if (length + 1 > this.#maximumRecordBytes) {
      throw new RangeError('Transaction record exceeds the configured physical byte limit.')
    }
    // Geometric growth also bounds bookkeeping when a producer sends tiny
    // chunks. Retaining one view per byte would defeat the byte budget.
    if (!this.#buffer || this.#buffer.length < length) {
      const capacity = Math.min(this.#maximumRecordBytes, Math.max(length, (this.#buffer?.length ?? 512) * 2))
      const next = Buffer.allocUnsafe(capacity)
      this.#buffer?.copy(next, 0, 0, this.#recordBytes)
      this.#buffer = next
    }
    this.#buffer.set(bytes, this.#recordBytes)
    this.#recordBytes = length
  }

  private record(bytes: Uint8Array): void {
    if (!bytes.length) throw new TypeError('Transaction records must not be empty.')
    if (bytes.length + 1 > this.#maximumRecordBytes) throw new RangeError('Transaction record exceeds the configured physical byte limit.')
    const record: unknown = JSON.parse(this.#decoder.decode(bytes))
    this.#buffer = undefined
    this.#recordBytes = 0
    if (!Array.isArray(record)) throw new TypeError('Transaction record must be a tuple.')
    if (!this.#header) {
      if (record.length !== 3 || record[0] !== 'header' || !Array.isArray(record[2]) ||
        record[2].length !== 3 || record[2].some((count: unknown) => !Number.isSafeInteger(count) || (count as number) < 0)) {
        throw new TypeError('Transaction record header is invalid.')
      }
      this.#header = this.#admission.header(record[1])
      this.#expected = record[2] as number[]
      return
    }
    const lengths = [this.#manifest.length, this.#upserts.length, this.#deletes.length]
    while (this.#phase < 3 && lengths[this.#phase] === this.#expected![this.#phase]) this.#phase++
    if (record.length !== 2 || record[0] !== ['manifest', 'upsert', 'delete'][this.#phase]) {
      throw new TypeError('Transaction record order or count is invalid.')
    }
    if (this.#phase === 0) this.#manifest.push(this.#admission.reference(record[1]))
    else if (this.#phase === 1) this.#upserts.push(this.#admission.shard(record[1]))
    else this.#deletes.push(this.#admission.deletion(record[1]))
  }
}

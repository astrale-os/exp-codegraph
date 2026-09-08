/** Private views of packed JSON. A flat table owns no reconstructed row arrays. */
export class PackedNumericRows {
  readonly #data: readonly unknown[]
  readonly #width: number
  readonly #flat: boolean
  readonly length: number

  constructor(input: unknown, width: number, flat: boolean, path: string) {
    this.#data = array(input, path)
    if (flat && this.#data.length % width !== 0) throw new TypeError(`Packed ${path} has an incomplete row.`)
    this.#width = width
    this.#flat = flat
    this.length = flat ? this.#data.length / width : this.#data.length
  }

  /** Projection-only: semantic admission has already checked every numeric cell. */
  field(row: number, column: number): number {
    return (this.#flat ? this.#data[row * this.#width + column] :
      (this.#data[row] as readonly unknown[])[column]) as number
  }

  /** A decoder may reuse its local scratch after consuming each logical row. */
  row(index: number, scratch: unknown[]): unknown {
    if (!this.#flat) return this.#data[index]
    scratch.length = this.#width
    for (let column = 0; column < this.#width; column++) scratch[column] = this.#data[index * this.#width + column]
    return scratch
  }
}

const OCCURRENCE_NUMBERS = [1, 2, 3, 4, 5, 7, 8, 9, 10] as const

export class PackedOccurrenceRows {
  readonly #data: readonly unknown[]
  readonly #ids: readonly unknown[] | undefined
  readonly #origins: readonly unknown[] | undefined
  readonly length: number

  constructor(input: unknown, columns: boolean) {
    const data = array(input, 'occurrences')
    if (!columns) { this.#data = data; this.length = data.length; return }
    if (data.length !== 3) throw new TypeError('Packed occurrence columns must have exactly three entries.')
    this.#ids = array(data[0], 'occurrence identities')
    this.#data = array(data[1], 'occurrence numbers')
    this.#origins = array(data[2], 'occurrence origins')
    this.length = this.#ids.length
    if (this.#data.length !== this.length * OCCURRENCE_NUMBERS.length || this.#origins.length !== this.length) {
      throw new TypeError('Packed occurrence columns have different row counts.')
    }
  }

  field(row: number, column: number): unknown {
    if (!this.#ids) return (this.#data[row] as readonly unknown[])[column]
    if (column === 0) return this.#ids[row]
    if (column === 6) return this.#origins![row]
    return this.#data[row * OCCURRENCE_NUMBERS.length + column - (column > 6 ? 2 : 1)]
  }

  row(index: number, scratch: unknown[]): unknown {
    if (!this.#ids) return this.#data[index]
    scratch.length = 11
    scratch[0] = this.#ids[index]
    scratch[6] = this.#origins![index]
    for (let column = 0; column < OCCURRENCE_NUMBERS.length; column++) {
      scratch[OCCURRENCE_NUMBERS[column]!] = this.#data[index * OCCURRENCE_NUMBERS.length + column]
    }
    return scratch
  }
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Packed ${path} must be an array.`)
  return value
}

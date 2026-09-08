/** Private views of packed JSON. A flat table owns no reconstructed row arrays. */
export class PackedNumericRows {
    #data;
    #width;
    #flat;
    length;
    constructor(input, width, flat, path) {
        this.#data = array(input, path);
        if (flat && this.#data.length % width !== 0)
            throw new TypeError(`Packed ${path} has an incomplete row.`);
        this.#width = width;
        this.#flat = flat;
        this.length = flat ? this.#data.length / width : this.#data.length;
    }
    /** Projection-only: semantic admission has already checked every numeric cell. */
    field(row, column) {
        return (this.#flat ? this.#data[row * this.#width + column] :
            this.#data[row][column]);
    }
    /** A decoder may reuse its local scratch after consuming each logical row. */
    row(index, scratch) {
        if (!this.#flat)
            return this.#data[index];
        scratch.length = this.#width;
        for (let column = 0; column < this.#width; column++)
            scratch[column] = this.#data[index * this.#width + column];
        return scratch;
    }
}
const OCCURRENCE_NUMBERS = [1, 2, 3, 4, 5, 7, 8, 9, 10];
export class PackedOccurrenceRows {
    #data;
    #ids;
    #origins;
    length;
    constructor(input, columns) {
        const data = array(input, 'occurrences');
        if (!columns) {
            this.#data = data;
            this.length = data.length;
            return;
        }
        if (data.length !== 3)
            throw new TypeError('Packed occurrence columns must have exactly three entries.');
        this.#ids = array(data[0], 'occurrence identities');
        this.#data = array(data[1], 'occurrence numbers');
        this.#origins = array(data[2], 'occurrence origins');
        this.length = this.#ids.length;
        if (this.#data.length !== this.length * OCCURRENCE_NUMBERS.length || this.#origins.length !== this.length) {
            throw new TypeError('Packed occurrence columns have different row counts.');
        }
    }
    field(row, column) {
        if (!this.#ids)
            return this.#data[row][column];
        if (column === 0)
            return this.#ids[row];
        if (column === 6)
            return this.#origins[row];
        return this.#data[row * OCCURRENCE_NUMBERS.length + column - (column > 6 ? 2 : 1)];
    }
    row(index, scratch) {
        if (!this.#ids)
            return this.#data[index];
        scratch.length = 11;
        scratch[0] = this.#ids[index];
        scratch[6] = this.#origins[index];
        for (let column = 0; column < OCCURRENCE_NUMBERS.length; column++) {
            scratch[OCCURRENCE_NUMBERS[column]] = this.#data[index * OCCURRENCE_NUMBERS.length + column];
        }
        return scratch;
    }
}
function array(value, path) {
    if (!Array.isArray(value))
        throw new TypeError(`Packed ${path} must be an array.`);
    return value;
}
//# sourceMappingURL=body-rows.js.map
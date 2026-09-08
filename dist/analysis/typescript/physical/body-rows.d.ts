/** Private views of packed JSON. A flat table owns no reconstructed row arrays. */
export declare class PackedNumericRows {
    #private;
    readonly length: number;
    constructor(input: unknown, width: number, flat: boolean, path: string);
    /** Projection-only: semantic admission has already checked every numeric cell. */
    field(row: number, column: number): number;
    /** A decoder may reuse its local scratch after consuming each logical row. */
    row(index: number, scratch: unknown[]): unknown;
}
export declare class PackedOccurrenceRows {
    #private;
    readonly length: number;
    constructor(input: unknown, columns: boolean);
    field(row: number, column: number): unknown;
    row(index: number, scratch: unknown[]): unknown;
}

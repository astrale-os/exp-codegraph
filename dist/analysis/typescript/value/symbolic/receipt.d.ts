export declare const COMPUTATION_RECEIPT_BYTES: number;
export declare const COMPUTATION_WITNESS_BYTES: number;
/** Only an exact tag match skips hashing; a slot collision records both keys. */
export declare function recordComputationWitness(tags: Float64Array, identity: number | undefined): boolean;
/** A negative membership answer proves absence; every positive forces a miss. */
export declare class ComputationReceipt {
    #private;
    constructor(words?: Uint32Array);
    add(key: string): void;
    intersects(keys: Iterable<string>): boolean;
    /** Stream one temporary digest across independent receipts without retaining the delta. */
    static hashes(keys: Iterable<string>): Iterable<Buffer>;
    mayContain(digest: Buffer): boolean;
    /** Folding preserves every inserted bit, unlike truncation or resampling. */
    compact(): ComputationReceipt | undefined;
    get bytes(): number;
}

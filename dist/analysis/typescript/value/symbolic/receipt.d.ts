export declare const COMPUTATION_RECEIPT_BYTES: number;
/** A negative membership answer proves absence; every positive forces a miss. */
export declare class ComputationReceipt {
    #private;
    constructor(words?: Uint32Array);
    add(key: string): void;
    intersects(keys: Iterable<string>): boolean;
    /** Folding preserves every inserted bit, unlike truncation or resampling. */
    compact(): ComputationReceipt | undefined;
    get bytes(): number;
}

/** Bounded, aging request counts. Equal-frequency scans do not evict resident work. */
export declare class RequestFrequency {
    #private;
    constructor(maximumBytes: number);
    get bytes(): number;
    record(key: string): void;
    estimate(key: string): number;
    private position;
}

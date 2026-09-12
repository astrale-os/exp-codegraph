/** No getters, proxies, classes or hidden references enter retained computations. */
export declare function capturePortable<Value>(input: Value): {
    value: Value;
    encoded: Buffer;
} | undefined;
export declare function restorePortable<Value>(encoded: Buffer): Value;

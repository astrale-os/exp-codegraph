/**
 * Shared declaration wave size. Rich API results remain resident until a worker batch is emitted,
 * so bounding the wave independently from source bytes prevents several valid large APIs from
 * exhausting the otherwise memory-bounded worker.
 */
export const SPECIFICATION_COMPILER_BATCH_CAPACITY = 4;
//# sourceMappingURL=resource-limits.js.map
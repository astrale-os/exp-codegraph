/**
 * Operational regression ceilings anchored to the governed Gate 0 TypeSpec/Kernel workloads.
 * They are qualification limits, not promises that every repository has the same cost shape.
 */
export const TYPE_SPEC_APPLICATION_LIMITS = Object.freeze({
  maximumConcurrentSpecificationCompilations: 4,
  maximumRetainedSnapshots: 2,
  maximumFocusedCheckMilliseconds: 12_000,
  maximumColdFullCheckMilliseconds: 75_000,
  maximumWarmFullCheckMilliseconds: 20_000,
  maximumNativeStartupMilliseconds: 3_000,
  maximumSQLiteBytes: 512 * 1024 * 1024,
  maximumCheckHeapMiB: 1_280,
  maximumInteractiveHeapMiB: 2_048,
})

/**
 * Operational regression ceilings anchored to the governed Gate 0 TypeSpec/Kernel workloads.
 * They are qualification limits, not promises that every repository has the same cost shape.
 */
export const TYPE_SPEC_APPLICATION_LIMITS = Object.freeze({
  maximumConcurrentSpecificationCompilations: 4,
  maximumRetainedSnapshots: 2,
  maximumFocusedCheckMilliseconds: 12_000,
  // The authoritative Kernel spine now contains 306 specifications (150 at the Gate 4 baseline).
  // Exact runs ranged from 185,478.13 to 381,897.14 ms. This is a diagnostic reference ceiling;
  // causal cold regression is governed by the isolated candidate/baseline experiment instead.
  maximumColdFullCheckMilliseconds: 300_000,
  maximumWarmFullCheckMilliseconds: 20_000,
  maximumUnchangedRestartMilliseconds: 10_000,
  maximumSingleOwnerRefreshMilliseconds: 5_000,
  maximumNativeStartupMilliseconds: 3_000,
  maximumSQLiteBytes: 512 * 1024 * 1024,
  maximumCheckHeapMiB: 1_280,
  // Exact 306-spec Kernel application proof peaked at 3,145.47 MiB RSS and settled at 2,624.95 MiB.
  // This ceiling measures the whole Node application process, not only the V8 heap.
  maximumInteractiveHeapMiB: 3_584,
})

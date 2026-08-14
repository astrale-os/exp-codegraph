export const TYPE_SPEC_APPLICATION_LIMITS = {
  maximumConcurrentSpecificationCompilations: 4,
  maximumRetainedSnapshots: 2,
  maximumFocusedCheckMilliseconds: 12_000,
  maximumColdFullCheckMilliseconds: 75_000,
  maximumWarmFullCheckMilliseconds: 20_000,
  maximumNativeStartupMilliseconds: 3_000,
  maximumSQLiteBytes: 536_870_912,
  maximumCheckHeapMiB: 1_280,
  maximumInteractiveHeapMiB: 2_048,
} as const

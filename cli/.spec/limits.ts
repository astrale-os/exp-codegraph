export const CLI_CHECK_LIMITS = {
  maximumWarmWholeMilliseconds: 5_000,
  maximumWarmSelectedMilliseconds: 5_000,
  minimumWarmSamples: 5,
  maximumWarmProcessMilliseconds: 15_000,
  maximumCatalogCheckpointDecodedBytes: 67_108_864,
} as const

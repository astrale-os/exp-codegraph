/** Process-boundary acceptance limits for the installed cg command. */
export const CLI_CHECK_LIMITS = Object.freeze({
  maximumWarmWholeMilliseconds: 5_000,
  maximumWarmSelectedMilliseconds: 5_000,
  minimumWarmSamples: 5,
  maximumWarmProcessMilliseconds: 15_000,
  maximumCatalogCheckpointDecodedBytes: 64 * 1024 * 1024,
  maximumAdditionalTextProjectionPointers: 5,
})

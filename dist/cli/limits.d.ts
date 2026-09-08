/** Process-boundary acceptance limits for the installed cg command. */
export declare const CLI_CHECK_LIMITS: Readonly<{
    maximumWarmWholeMilliseconds: 5000;
    maximumWarmSelectedMilliseconds: 5000;
    minimumWarmSamples: 5;
    maximumWarmProcessMilliseconds: 15000;
    maximumCatalogCheckpointDecodedBytes: number;
    maximumAdditionalTextProjectionPointers: 5;
}>;

/**
 * Operational regression ceilings anchored to the governed Gate 0 TypeSpec/Kernel workloads.
 * They are qualification limits, not promises that every repository has the same cost shape.
 */
export declare const TYPE_SPEC_APPLICATION_LIMITS: Readonly<{
    maximumConcurrentSpecificationCompilations: 4;
    maximumRetainedSnapshots: 2;
    maximumFocusedCheckMilliseconds: 12000;
    maximumColdFullCheckMilliseconds: 300000;
    maximumWarmFullCheckMilliseconds: 20000;
    maximumUnchangedRestartMilliseconds: 10000;
    maximumSingleOwnerRefreshMilliseconds: 5000;
    maximumNativeStartupMilliseconds: 3000;
    maximumSQLiteBytes: number;
    maximumDecodedCheckpointArtifactBytes: number;
    maximumDecodedCheckpointBytes: number;
    maximumCheckHeapMiB: 1280;
    maximumInteractiveHeapMiB: 3584;
}>;

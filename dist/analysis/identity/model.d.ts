declare const analysisIdentity: unique symbol;
export type AnalysisId<Kind extends string> = string & {
    readonly [analysisIdentity]: Kind;
};
export type AnalysisGenerationId = AnalysisId<'generation'>;
export type FactId = AnalysisId<'fact'>;
export type FactShardKey = AnalysisId<'fact-shard-key'>;
export type FactShardDigest = AnalysisId<'fact-shard-digest'>;
export type OccurrenceId = AnalysisId<'occurrence'>;
export type PassId = AnalysisId<'pass'>;
export type PolicyId = AnalysisId<'policy'>;
export type ProducerId = AnalysisId<'producer'>;
export type ProjectUniverseId = AnalysisId<'project-universe'>;
export type RepositoryId = AnalysisId<'repository'>;
export type SnapshotSetId = AnalysisId<'snapshot-set'>;
export type SourceId = AnalysisId<'source'>;
export type SourceManifestId = AnalysisId<'source-manifest'>;
export type SourceRevisionId = AnalysisId<'source-revision'>;
export type SymbolId = AnalysisId<'symbol'>;
export interface PortableSourceCoordinate {
    readonly repository: RepositoryId;
    readonly path: string;
}
export declare function admitAnalysisId<Kind extends string>(kind: Kind, value: string): AnalysisId<Kind>;
export declare function deriveAnalysisId<Kind extends string>(kind: Kind, namespace: string, input: unknown): AnalysisId<Kind>;
export declare function portablePath(path: string): string;
export declare function stableJson(value: unknown): string;
export {};

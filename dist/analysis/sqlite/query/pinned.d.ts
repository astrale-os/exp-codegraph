import type { DatabaseSync } from 'node:sqlite';
import type { Fact, FactHeader, FactShardReference } from '../../facts/index.ts';
import type { AnalysisGeneration } from '../../generation/index.ts';
import type { FactId } from '../../identity/index.ts';
import type { AnalysisQuery, CapabilityStatus, FactFilter, FactHeaderPage, FactPage, PageRequest } from '../../query/index.ts';
import type { FactPayloadCodecMap } from '../../facts/representation/index.ts';
export declare class SQLitePinnedQuery implements AnalysisQuery {
    #private;
    readonly generation: AnalysisGeneration;
    constructor(database: DatabaseSync, storeNamespace: string, generation: AnalysisGeneration, payloadCodecs: FactPayloadCodecMap, maximumDecompressedShardPayloadBytes: number, maximumCachedShardPayloadBytes: number, release: () => void | Promise<void>);
    manifest(): Promise<readonly FactShardReference[]>;
    capabilities(): Promise<readonly CapabilityStatus[]>;
    headers(filter?: FactFilter, page?: PageRequest): Promise<FactHeaderPage>;
    headersById(ids: readonly FactId[]): Promise<readonly FactHeader[]>;
    exportHeaders(filter?: FactFilter): AsyncIterable<FactHeader>;
    facts(filter?: FactFilter, page?: PageRequest): Promise<FactPage>;
    factsById(ids: readonly FactId[]): Promise<readonly Fact[]>;
    export(filter?: FactFilter): AsyncIterable<Fact>;
    [Symbol.asyncDispose](): Promise<void>;
    dispose(): Promise<void>;
    private decodeFact;
    private decodeHeader;
    private countFacts;
    private assertOpen;
}

import type { FactShardDigest } from '../identity/index.ts';
import type { Fact, FactHeader, FactShard, FactShardReference } from './types.ts';
export type { AnalysisFailure, AnalysisLimit, Completeness, Fact, FactHeader, FactProvenance, FactShard, FactShardReference, SourceSpan, } from './types.ts';
/** Read a fact envelope without invoking a lazy semantic payload getter. */
export declare function factHeader(fact: Fact): FactHeader;
export declare function factShardDigest(shard: Omit<FactShard, 'digest'>): FactShardDigest;
export declare function validateFactShard(shard: FactShard): readonly string[];
export declare function shardReference(shard: FactShard): FactShardReference;

import type { FactShardDigest } from '../identity/index.ts';
import type { Fact, FactShard } from './types.ts';
type SemanticFact = Omit<Fact, 'generation'>;
type ShardIdentity = Omit<FactShard, 'digest' | 'facts'> & {
    readonly facts: readonly SemanticFact[];
};
/** Private, owned JSON ingress only. The generic identity path remains the fallback. */
export declare function hashOwnedFactShard(input: ShardIdentity): {
    readonly digest: FactShardDigest;
    readonly semanticPayloadBytes: number;
} | undefined;
export {};

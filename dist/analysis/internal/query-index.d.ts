import { type Fact, type FactShard, type FactShardReference } from '../facts/index.ts';
import type { CapabilityStatus, FactFilter } from '../query/index.ts';
import { OrderedMap } from './ordered-map.ts';
/** Generation-neutral, immutable rows; only a reader binds the requested generation. */
export declare class MemoryFactIndex {
    #private;
    readonly facts: OrderedMap<Fact>;
    private constructor();
    static build(shards: ReadonlyMap<string, FactShard>): MemoryFactIndex;
    update(removed: readonly FactShard[], added: readonly FactShard[]): MemoryFactIndex;
    manifest(): readonly FactShardReference[];
    capabilities(declared: readonly string[]): readonly CapabilityStatus[];
    matching(filter: FactFilter): IterableIterator<Fact>;
    private candidates;
    private postings;
    private contributions;
}

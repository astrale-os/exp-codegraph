import { type FactShard } from '../facts/index.ts';
import type { FactTransaction } from '../generation/index.ts';
/** Compare the complete manifest without constructing and canonicalizing a second population. */
export declare function matchesMaterializedManifest(shards: ReadonlyMap<string, FactShard>, transaction: Pick<FactTransaction, 'manifest'>): boolean;

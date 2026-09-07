import type { Completeness } from '../facts/index.ts';
/**
 * Combine epistemic results without making producer or materializer traversal
 * order observable through the query contract.
 */
export declare function combineCompleteness(left: Completeness | undefined, right: Completeness): Completeness;

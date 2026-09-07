import type { Completeness } from './types.ts';
/**
 * Combine epistemic results without making producer or materializer traversal
 * order observable through the query contract.
 */
export declare function combineCompleteness(left: Completeness | undefined, right: Completeness): Completeness;

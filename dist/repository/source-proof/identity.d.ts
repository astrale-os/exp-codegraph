import type { SourceProof } from './model.ts';
/** Create one canonical path-independent source proof identity. */
export declare function createSourceProof(input: Omit<SourceProof, 'id'>): SourceProof;

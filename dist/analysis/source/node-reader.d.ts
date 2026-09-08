import type { SourceTextReader } from './model.ts';
/** Construct a filesystem reader under one explicit application-owned root. */
export declare function createNodeSourceTextReader(root: string): SourceTextReader;

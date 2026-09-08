import type { ModuleSourceReference } from '../resource/index.ts';
/** Canonicalize a physical source once per coherent compiler operation. */
export declare function canonicalModuleTypeScriptPath(path: string): string;
/** Deduplicate immutable source spans in linear time while preserving the canonical first entry. */
export declare function deduplicateModuleSourceReferences(references: readonly ModuleSourceReference[]): readonly ModuleSourceReference[];

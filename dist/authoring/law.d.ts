import type { CodeAnchorReference, TestEvidenceReference } from './evidence.ts';
export interface LawDefinition<Id extends string = string> {
    readonly id: Id;
    readonly statement: string;
    readonly formal?: string;
    /** Optional stable test identities in explicit module-root-relative evidence files. */
    readonly tests?: readonly TestEvidenceReference[];
    /** Optional module-root-relative implementation anchors, for a law no test can attach to. */
    readonly code?: readonly CodeAnchorReference[];
}
/** Preserve one statically extractable semantic law without adding runtime behavior. */
export declare function defineLaw<const Definition extends LawDefinition>(definition: Definition): Definition;

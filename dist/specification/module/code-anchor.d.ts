import type { CodeAnchorReference } from '../../authoring/evidence.ts';
import type { Diagnostic } from '../../source/diagnostic.ts';
export interface CodeAnchoredLawResource {
    readonly source: string;
    readonly text: string;
    readonly definitions: readonly {
        readonly exportName: string;
        readonly code?: readonly CodeAnchorReference[];
    }[];
}
/** Resolve authored code anchors to files and declarations without importing or executing code. */
export declare function resolveCodeAnchors(root: string, moduleRoot: string, laws: readonly CodeAnchoredLawResource[]): Promise<readonly Diagnostic[]>;

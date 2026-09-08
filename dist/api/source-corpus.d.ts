import ts from 'typescript';
import { type ExternalReference } from './external.ts';
export interface DeclarationEntry {
    readonly files: ReadonlySet<string>;
    readonly externalReferences: readonly ExternalReference[];
    readonly ambientEffects: boolean;
    /** Resolved module references omitted from this entrypoint's canonical source closure. */
    readonly rootReferences: ReadonlySet<string>;
}
export interface DeclarationSourceEvidence {
    readonly bytes: number;
    readonly externalReferences: readonly ExternalReference[];
    readonly ambientEffects: boolean;
    readonly dependencies: readonly string[];
    readonly rootReferences: readonly string[];
}
/** Immutable operation-owned declaration source corpus shared by every entrypoint traversal. */
export declare function createDeclarationSourceCorpus(projectRoot: string, options: ts.CompilerOptions, host: ts.CompilerHost): {
    discover(mainFile: string): DeclarationEntry;
    evidence(file: string): DeclarationSourceEvidence;
};
export declare function permittedDeclarationPath(projectRoot: string, file: string): boolean;
export declare function declarationRealpathSafe(file: string): string | undefined;
export declare function declarationPathInside(root: string, target: string): boolean;

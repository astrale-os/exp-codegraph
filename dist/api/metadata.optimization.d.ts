import type ts from 'typescript';
import type { ApiDeclarationMetadata } from './model.ts';
export interface DeclarationMetadataCandidate {
    readonly file: string;
    readonly ownerIdentity: string;
    readonly key: string;
    readonly symbol: ts.Symbol;
    readonly node: ts.Node;
}
/** Index one immutable Program once while retaining owner-local closure projection. */
export declare function declarationMetadataIndexOnce(checker: ts.TypeChecker, root: string, collect: () => ReadonlyMap<string, readonly DeclarationMetadataCandidate[]>): ReadonlyMap<string, readonly DeclarationMetadataCandidate[]>;
/** Materialize one checker/node/symbol metadata value only when an owner actually requests it. */
export declare function declarationMetadataOnce(checker: ts.TypeChecker, root: string, candidate: DeclarationMetadataCandidate, materialize: () => ApiDeclarationMetadata): ApiDeclarationMetadata;

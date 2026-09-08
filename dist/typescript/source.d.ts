import type ts from 'typescript';
import type { SourceLocation } from '../analysis/typescript/surface/model.ts';
export type SourceCoordinate = {
    readonly kind: 'catalog';
    readonly file: string;
} | {
    readonly kind: 'external';
    readonly external: string;
};
/**
 * Give a TypeScript source a portable identity without leaking checkout paths.
 * Catalog files remain relative paths; dependencies and compiler libraries use
 * stable package/platform coordinates.
 */
export declare function sourceCoordinate(catalogRoot: string, file: string): SourceCoordinate;
export declare function sourceIdentity(catalogRoot: string, file: string): string;
export declare function locationSource(location: SourceLocation): string;
export declare function locationOf(catalogRoot: string, node: ts.Node | ts.SourceFile | undefined): SourceLocation;

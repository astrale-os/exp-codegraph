import ts from 'typescript';
import type { ObservedDeclaration } from '../../analysis/typescript/surface/model.ts';
import type { DeclarationSurfaceSemantics } from './semantics.ts';
export declare function observeDeclaration(catalogRoot: string, checker: ts.TypeChecker, symbol: ts.Symbol, exportPaths: readonly (readonly string[])[], semantics: DeclarationSurfaceSemantics): {
    declaration: ObservedDeclaration;
    references: ReadonlyMap<string, ts.Symbol>;
};

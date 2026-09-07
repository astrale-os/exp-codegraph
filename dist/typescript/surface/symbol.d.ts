import ts from 'typescript';
import type { ObservedDeclarationKind } from '../../analysis/typescript/surface/model.ts';
import { locationOf } from '../source.ts';
export declare function canonicalSymbolIdentity(catalogRoot: string, input: ts.Symbol): string;
/** Canonical identity used by declaration and executable TypeScript source navigation. */
export declare function semanticTokenIdentity(checker: ts.TypeChecker, symbol: ts.Symbol, catalogRoot: string): string;
export { locationOf };
export declare function declarationKind(checker: ts.TypeChecker, symbol: ts.Symbol): ObservedDeclarationKind;
export interface FactoryFacetDeclarations {
    readonly type: ts.TypeAliasDeclaration;
    readonly value: ts.FunctionDeclaration | ts.VariableDeclaration;
}
/**
 * Recognize the deliberate TypeScript factory merge used by public APIs: one type alias, one
 * runtime value, and an optional namespace facet under the same symbol. The value may be callable
 * (`NodeId`) or an object-valued constructor (`Domain`); the namespace may own advanced types and
 * operations (`Ref.Class`, `Ref.is`). Every facet remains independently observable.
 */
export declare function factoryFacetDeclarations(_checker: ts.TypeChecker, symbol: ts.Symbol): FactoryFacetDeclarations | undefined;
export declare function isPureNamespaceSymbol(symbol: ts.Symbol): boolean;
/** Return whether one value/type declaration also owns an explicitly merged namespace facet. */
export declare function hasNamespaceFacet(symbol: ts.Symbol): boolean;
export declare function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol;
export declare function referencedSymbol(type: ts.Type): ts.Symbol | undefined;
export declare function isStableDeclarationSymbol(symbol: ts.Symbol): boolean;
export declare function symbolWithinCatalog(catalogRoot: string, symbol: ts.Symbol): boolean;
export declare function firstDeclaration(symbol: ts.Symbol): ts.Declaration | undefined;
export declare function exportIsTypeOnly(exported: ts.Symbol, target: ts.Symbol, kind: ObservedDeclarationKind): boolean;

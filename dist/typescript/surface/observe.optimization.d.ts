import type ts from 'typescript';
import type { DeclarationSurfaceSemantics } from './semantics.ts';
import { observeDeclaration } from './declaration.ts';
type DeclarationObservation = ReturnType<typeof observeDeclaration>;
/** Reuse one immutable checker-owned declaration normalization across entrypoint projections. */
export declare function observeDeclarationOnce(catalogRoot: string, checker: ts.TypeChecker, symbol: ts.Symbol, semantics: DeclarationSurfaceSemantics): DeclarationObservation;
export {};

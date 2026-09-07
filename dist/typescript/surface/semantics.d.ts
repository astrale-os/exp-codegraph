/**
 * Authored semantics for the reusable declaration-compilation port.
 * The frozen V1 wire was a qualification oracle, never a second production mode.
 */
export type DeclarationSurfaceSemantics = 'specification-v2';
export declare const DEFAULT_DECLARATION_SURFACE_SEMANTICS: DeclarationSurfaceSemantics;
export declare function declarationSurfaceVersion(_semantics: DeclarationSurfaceSemantics): 2;

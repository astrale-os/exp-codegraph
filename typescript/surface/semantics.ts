/**
 * Authored semantics for the reusable declaration-compilation port.
 * The frozen V1 wire was a qualification oracle, never a second production mode.
 */
export type DeclarationSurfaceSemantics = 'specification-v2'

export const DEFAULT_DECLARATION_SURFACE_SEMANTICS: DeclarationSurfaceSemantics =
  'specification-v2'

export function declarationSurfaceVersion(_semantics: DeclarationSurfaceSemantics): 2 {
  return 2
}

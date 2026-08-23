import type ts from 'typescript'

import type { DeclarationSurfaceSemantics } from './semantics.ts'
import { observeDeclaration } from './declaration.ts'
import { canonicalSymbolIdentity } from './symbol.ts'

type DeclarationObservation = ReturnType<typeof observeDeclaration>

const observations = new WeakMap<ts.TypeChecker, Map<string, DeclarationObservation>>()

/** Reuse one immutable checker-owned declaration normalization across entrypoint projections. */
export function observeDeclarationOnce(
  catalogRoot: string,
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  semantics: DeclarationSurfaceSemantics,
): DeclarationObservation {
  let byIdentity = observations.get(checker)
  if (!byIdentity) {
    byIdentity = new Map()
    observations.set(checker, byIdentity)
  }
  const identity = `${catalogRoot}\0${semantics}\0${canonicalSymbolIdentity(catalogRoot, symbol)}`
  const existing = byIdentity.get(identity)
  if (existing) return existing
  const observed = observeDeclaration(catalogRoot, checker, symbol, [], semantics)
  byIdentity.set(identity, observed)
  return observed
}

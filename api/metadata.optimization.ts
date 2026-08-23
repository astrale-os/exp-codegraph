import type ts from 'typescript'

import type { ApiDeclarationMetadata } from './model.ts'

export interface DeclarationMetadataCandidate {
  readonly file: string
  readonly ownerIdentity: string
  readonly key: string
  readonly symbol: ts.Symbol
  readonly node: ts.Node
}

interface CheckerMetadataCache {
  index?: ReadonlyMap<string, readonly DeclarationMetadataCandidate[]>
  readonly metadata: WeakMap<ts.Node, WeakMap<ts.Symbol, ApiDeclarationMetadata>>
}

const caches = new WeakMap<ts.TypeChecker, Map<string, CheckerMetadataCache>>()

/** Index one immutable Program once while retaining owner-local closure projection. */
export function declarationMetadataIndexOnce(
  checker: ts.TypeChecker,
  root: string,
  collect: () => ReadonlyMap<string, readonly DeclarationMetadataCandidate[]>,
): ReadonlyMap<string, readonly DeclarationMetadataCandidate[]> {
  const cache = checkerCache(checker, root)
  if (cache.index) return cache.index
  cache.index = collect()
  return cache.index
}

/** Materialize one checker/node/symbol metadata value only when an owner actually requests it. */
export function declarationMetadataOnce(
  checker: ts.TypeChecker,
  root: string,
  candidate: DeclarationMetadataCandidate,
  materialize: () => ApiDeclarationMetadata,
): ApiDeclarationMetadata {
  const cache = checkerCache(checker, root)
  let bySymbol = cache.metadata.get(candidate.node)
  if (!bySymbol) {
    bySymbol = new WeakMap()
    cache.metadata.set(candidate.node, bySymbol)
  }
  const existing = bySymbol.get(candidate.symbol)
  if (existing) return existing
  const metadata = materialize()
  bySymbol.set(candidate.symbol, metadata)
  return metadata
}

function checkerCache(checker: ts.TypeChecker, root: string): CheckerMetadataCache {
  let byRoot = caches.get(checker)
  if (!byRoot) {
    byRoot = new Map()
    caches.set(checker, byRoot)
  }
  const existing = byRoot.get(root)
  if (existing) return existing
  const created: CheckerMetadataCache = {
    metadata: new WeakMap(),
  }
  byRoot.set(root, created)
  return created
}

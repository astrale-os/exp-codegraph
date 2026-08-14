import ts from 'typescript'

import type { ObservedDeclarationKind } from '../../analysis/typescript/surface/model.ts'

import { locationOf, sourceCoordinate, sourceIdentity } from '../source.ts'

export function canonicalSymbolIdentity(catalogRoot: string, input: ts.Symbol): string {
  const declarations = [...(input.declarations ?? [])].sort(
    (left, right) =>
      compare(left.getSourceFile().fileName, right.getSourceFile().fileName) ||
      left.pos - right.pos,
  )
  const coordinates = declarations
    .map((declaration) => {
      const file = sourceIdentity(catalogRoot, declaration.getSourceFile().fileName)
      return `${file}:${declaration.pos}:${declaration.kind}`
    })
    .join('|')
  return `ts:${coordinates || '<synthetic>'}#${encodeURIComponent(input.getName())}`
}

/** Canonical identity used by declaration and executable TypeScript source navigation. */
export function semanticTokenIdentity(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  catalogRoot: string,
): string {
  const declaration = firstDeclaration(symbol)
  const owner = declaration?.parent
  if (
    declaration &&
    owner &&
    (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) &&
    owner.name &&
    (ts.isMethodSignature(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isPropertySignature(declaration) ||
      ts.isPropertyDeclaration(declaration))
  ) {
    const ownerSymbol = checker.getSymbolAtLocation(owner.name)
    if (ownerSymbol) {
      return `${canonicalSymbolIdentity(catalogRoot, resolveAlias(checker, ownerSymbol))}#${symbol.getName()}`
    }
  }
  return canonicalSymbolIdentity(catalogRoot, symbol)
}

export { locationOf }

export function declarationKind(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
): ObservedDeclarationKind {
  if (factoryFacetDeclarations(checker, symbol)) return 'factory'
  if (symbol.flags & ts.SymbolFlags.Class) return 'class'
  if (symbol.flags & ts.SymbolFlags.Interface) return 'interface'
  if (symbol.flags & ts.SymbolFlags.Module) return 'namespace'
  const declaration = firstDeclaration(symbol)
  if (symbol.flags & ts.SymbolFlags.Function) return 'callable'
  if (declaration) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) return 'callable'
  }
  if (
    symbol.flags &
    (ts.SymbolFlags.TypeAlias |
      ts.SymbolFlags.Variable |
      ts.SymbolFlags.Enum |
      ts.SymbolFlags.EnumMember)
  ) {
    return 'value'
  }
  return 'unsupported'
}

export interface FactoryFacetDeclarations {
  readonly type: ts.TypeAliasDeclaration
  readonly value: ts.FunctionDeclaration | ts.VariableDeclaration
}

/**
 * Recognize the deliberate TypeScript factory merge used by public APIs: one type alias, one
 * runtime value, and an optional namespace facet under the same symbol. The value may be callable
 * (`NodeId`) or an object-valued constructor (`Domain`); the namespace may own advanced types and
 * operations (`Ref.Class`, `Ref.is`). Every facet remains independently observable.
 */
export function factoryFacetDeclarations(
  _checker: ts.TypeChecker,
  symbol: ts.Symbol,
): FactoryFacetDeclarations | undefined {
  const declarations = symbol.declarations ?? []
  const types = declarations.filter(ts.isTypeAliasDeclaration)
  const values = declarations.filter(
    (declaration): declaration is ts.FunctionDeclaration | ts.VariableDeclaration =>
      ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration),
  )
  if (
    types.length !== 1 ||
    values.length !== 1 ||
    declarations.some(
      (declaration) =>
        !ts.isTypeAliasDeclaration(declaration) &&
        !ts.isFunctionDeclaration(declaration) &&
        !ts.isVariableDeclaration(declaration) &&
        !ts.isModuleDeclaration(declaration),
    )
  ) {
    return
  }
  return { type: types[0]!, value: values[0]! }
}

export function isPureNamespaceSymbol(symbol: ts.Symbol): boolean {
  const declarations = symbol.declarations ?? []
  return (
    declarations.length > 0 &&
    declarations.every(
      (declaration) => ts.isModuleDeclaration(declaration) || ts.isSourceFile(declaration),
    )
  )
}

/** Return whether one value/type declaration also owns an explicitly merged namespace facet. */
export function hasNamespaceFacet(symbol: ts.Symbol): boolean {
  const declarations = symbol.declarations ?? []
  return (
    declarations.some(ts.isModuleDeclaration) &&
    declarations.some((declaration) => !ts.isModuleDeclaration(declaration))
  )
}

export function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol
  try {
    return checker.getAliasedSymbol(symbol)
  } catch {
    return symbol
  }
}

export function referencedSymbol(type: ts.Type): ts.Symbol | undefined {
  return type.aliasSymbol ?? type.getSymbol()
}

export function isStableDeclarationSymbol(symbol: ts.Symbol): boolean {
  return Boolean(
    symbol.declarations?.some((declaration) => {
      if (ts.isTypeParameterDeclaration(declaration)) return false
      const name = (declaration as ts.NamedDeclaration).name
      return name !== undefined && !ts.isComputedPropertyName(name)
    }),
  )
}

export function symbolWithinCatalog(catalogRoot: string, symbol: ts.Symbol): boolean {
  return Boolean(
    symbol.declarations?.some(
      (declaration) =>
        sourceCoordinate(catalogRoot, declaration.getSourceFile().fileName).kind === 'catalog',
    ),
  )
}

export function firstDeclaration(symbol: ts.Symbol): ts.Declaration | undefined {
  return [...(symbol.declarations ?? [])].sort(
    (left, right) =>
      compare(left.getSourceFile().fileName, right.getSourceFile().fileName) ||
      left.pos - right.pos,
  )[0]
}

export function exportIsTypeOnly(
  exported: ts.Symbol,
  target: ts.Symbol,
  kind: ObservedDeclarationKind,
): boolean {
  for (const declaration of exported.declarations ?? []) {
    if (ts.isExportSpecifier(declaration)) {
      if (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly) return true
    }
    if (ts.isExportDeclaration(declaration) && declaration.isTypeOnly) return true
  }
  if (kind === 'factory') return false
  return (
    kind === 'interface' ||
    (target.flags & ts.SymbolFlags.TypeAlias) !== 0 ||
    (target.flags & ts.SymbolFlags.Value) === 0
  )
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

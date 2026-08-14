import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

import type { DeclarationTypeScriptProject } from './surface/project.ts'

export type TypeScriptDependencyKind = 'dynamic' | 'export' | 'runtime' | 'side-effect' | 'type'

export interface TypeScriptDependencyReference {
  readonly specifier: string
  readonly node: ts.Node
  readonly kind: TypeScriptDependencyKind
  readonly typeOnly: boolean
}

export interface UnresolvedTypeScriptDependency {
  readonly kind: 'dynamic' | 'require'
  readonly node: ts.Node
}

export interface TypeScriptDependencyReferences {
  readonly references: readonly TypeScriptDependencyReference[]
  readonly unresolved: readonly UnresolvedTypeScriptDependency[]
}

/** Observe static module references without assigning architecture-specific ownership semantics. */
export function typeScriptDependencyReferences(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): TypeScriptDependencyReferences {
  const references: TypeScriptDependencyReference[] = []
  const unresolved: UnresolvedTypeScriptDependency[] = []
  const add = (
    specifier: string,
    node: ts.Node,
    kind: TypeScriptDependencyKind,
    typeOnly: boolean,
  ): void => {
    references.push({ specifier, node, kind, typeOnly })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      for (const edge of importEdges(node)) {
        add(node.moduleSpecifier.text, node.moduleSpecifier, edge.kind, edge.typeOnly)
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text, node.moduleSpecifier, 'export', exportIsTypeOnly(node))
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression.text, node.moduleReference.expression, 'runtime', false)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      add(node.argument.literal.text, node.argument.literal, 'type', true)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteralLike(argument)) {
        add(argument.text, argument, 'dynamic', false)
      } else {
        unresolved.push({ kind: 'dynamic', node: argument ?? node })
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      isModuleRequire(checker, node.expression)
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteralLike(argument)) {
        add(argument.text, argument, 'runtime', false)
      } else {
        unresolved.push({ kind: 'require', node: argument ?? node })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { references, unresolved }
}

export function resolveTypeScriptModuleFile(
  project: DeclarationTypeScriptProject,
  source: ts.SourceFile,
  specifier: string,
): string | undefined {
  const result = ts.resolveModuleName(
    specifier,
    source.fileName,
    project.program.getCompilerOptions(),
    ts.sys,
  ).resolvedModule
  if (!result?.resolvedFileName) return
  const file = resolve(result.resolvedFileName)
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

function importEdges(
  node: ts.ImportDeclaration,
): readonly { kind: 'runtime' | 'side-effect' | 'type'; typeOnly: boolean }[] {
  const clause = node.importClause
  if (!clause) return [{ kind: 'side-effect', typeOnly: false }]
  if (clause.isTypeOnly) return [{ kind: 'type', typeOnly: true }]
  let runtime = Boolean(clause.name)
  let typeOnly = false
  const bindings = clause.namedBindings
  if (bindings && ts.isNamespaceImport(bindings)) runtime = true
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (element.isTypeOnly) typeOnly = true
      else runtime = true
    }
  }
  return [
    ...(runtime ? ([{ kind: 'runtime', typeOnly: false }] as const) : []),
    ...(typeOnly ? ([{ kind: 'type', typeOnly: true }] as const) : []),
  ]
}

function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true
  return Boolean(
    node.exportClause &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly),
  )
}

function isModuleRequire(checker: ts.TypeChecker, identifier: ts.Identifier): boolean {
  const symbol = checker.getSymbolAtLocation(identifier)
  if (!symbol) return true
  return (symbol.declarations ?? []).every(
    (declaration) => declaration.getSourceFile().isDeclarationFile,
  )
}

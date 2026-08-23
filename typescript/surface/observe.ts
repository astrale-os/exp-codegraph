import { relative, sep } from 'node:path'
import ts from 'typescript'

import type {
  ObservationIssue,
  ObservedDeclaration,
  ObservedExport,
  ObservedSurface,
} from '../../analysis/typescript/surface/model.ts'
import type { DeclarationTypeScriptProject } from './project.ts'
import type { DeclarationSurfaceSemantics } from './semantics.ts'

import { workspacePackageCoordinate } from '../package-coordinate.ts'
import { observeDeclarationOnce } from './observe.optimization.ts'
import {
  canonicalSymbolIdentity,
  declarationKind,
  exportIsTypeOnly,
  firstDeclaration,
  hasNamespaceFacet,
  isPureNamespaceSymbol,
  locationOf,
  resolveAlias,
  symbolWithinCatalog,
} from './symbol.ts'

export interface ObservePublicSurfaceOptions {
  readonly explicitExportsOnly?: boolean
  readonly ownedFiles?: ReadonlySet<string>
  readonly semantics?: DeclarationSurfaceSemantics
}

export function observePublicSurface(
  catalogRoot: string,
  project: DeclarationTypeScriptProject,
  entrypoint: string,
  options: ObservePublicSurfaceOptions = {},
): ObservedSurface {
  const semantics = options.semantics ?? 'specification-v2'
  const source = project.program.getSourceFile(entrypoint)
  if (!source) {
    return {
      exports: [],
      declarations: [],
      issues: [
        {
          code: 'MODULE_ENTRYPOINT_NOT_IN_PROJECT',
          message: 'The configured entrypoint is not included by the TypeScript project.',
          location: { file: portable(relative(catalogRoot, entrypoint)), line: 1, column: 1 },
        },
      ],
    }
  }
  const rootSymbol = project.checker.getSymbolAtLocation(source)
  if (!rootSymbol) {
    return {
      exports: [],
      declarations: [],
      issues: [
        {
          code: 'MODULE_ENTRYPOINT_SYMBOL_UNRESOLVED',
          message: 'TypeScript did not expose a module symbol for the configured entrypoint.',
          location: locationOf(catalogRoot, source),
        },
      ],
    }
  }

  const exports: ObservedExport[] = []
  const symbols = new Map<string, ts.Symbol>()
  const paths = new Map<string, string[][]>()
  const issues: ObservationIssue[] = []
  if (source.isDeclarationFile && !options.explicitExportsOnly) {
    issues.push({
      code: 'TYPESCRIPT_DECLARATION_ENTRYPOINT_UNSUPPORTED',
      message:
        'Declaration-only implementation entrypoints require a declaration-package observer.',
      location: locationOf(catalogRoot, source),
    })
  }
  collectExports(
    catalogRoot,
    project.checker,
    rootSymbol,
    [],
    exports,
    symbols,
    paths,
    issues,
    new Set(),
    options.explicitExportsOnly ?? false,
  )

  const declarations = new Map<string, ObservedDeclaration>()
  const pending = [...symbols.entries()]
  for (let index = 0; index < pending.length; index++) {
    const [identity, symbol] = pending[index]!
    if (declarations.has(identity)) continue
    if (
      !symbolWithinCatalog(catalogRoot, symbol) ||
      (options.ownedFiles && !symbolOwnedByFiles(symbol, options.ownedFiles))
    ) {
      const declaration = firstDeclaration(symbol)
      const declarationFile = declaration?.getSourceFile().fileName
      const packageCoordinate = declarationFile
        ? (project.externalCoordinates?.get(declarationFile) ??
          workspacePackageCoordinate(catalogRoot, declarationFile))
        : undefined
      declarations.set(identity, {
        identity,
        name: symbol.getName(),
        kind: declarationKind(project.checker, symbol),
        location: locationOf(catalogRoot, declaration),
        ...(packageCoordinate ? { packageCoordinate } : {}),
        exportPaths: paths.get(identity) ?? [],
        referencedDeclarations: [],
        issues: [],
      })
      continue
    }
    const observation = observeDeclarationOnce(
      catalogRoot,
      project.checker,
      symbol,
      semantics,
    )
    declarations.set(identity, {
      ...observation.declaration,
      exportPaths: paths.get(identity) ?? [],
    })
    issues.push(
      ...observation.declaration.issues.map((issue) => ({
        ...issue,
        declaration: issue.declaration ?? identity,
      })),
    )
    for (const [referenceIdentity, referenceSymbol] of observation.references) {
      if (!symbols.has(referenceIdentity)) {
        symbols.set(referenceIdentity, referenceSymbol)
        pending.push([referenceIdentity, referenceSymbol])
      }
    }
  }

  return {
    exports,
    declarations: [...declarations.values()].sort((left, right) =>
      compare(left.identity, right.identity),
    ),
    issues: deduplicateIssues(issues),
  }
}

function symbolOwnedByFiles(symbol: ts.Symbol, files: ReadonlySet<string>): boolean {
  return Boolean(
    symbol.declarations?.some((declaration) => files.has(declaration.getSourceFile().fileName)),
  )
}

function collectExports(
  catalogRoot: string,
  checker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
  namespace: readonly string[],
  output: ObservedExport[],
  symbols: Map<string, ts.Symbol>,
  paths: Map<string, string[][]>,
  issues: ObservationIssue[],
  active: Set<string>,
  explicitExportsOnly: boolean,
): void {
  const moduleIdentity = canonicalSymbolIdentity(catalogRoot, moduleSymbol)
  if (active.has(moduleIdentity)) {
    issues.push({
      code: 'TYPESCRIPT_NAMESPACE_CYCLE',
      message: `Recursive namespace export cannot be exhaustively observed: ${namespace.join('.')}`,
      location: locationOf(catalogRoot, firstDeclaration(moduleSymbol)),
    })
    return
  }
  active.add(moduleIdentity)
  const exportedSymbols = checker
    .getExportsOfModule(moduleSymbol)
    .map((exported, index) => ({ exported, index, target: resolveAlias(checker, exported) }))
    .sort(
      (left, right) =>
        compareExportDeclarations(left.exported, left.target, right.exported, right.target) ||
        left.index - right.index,
    )
  for (const { exported, target } of exportedSymbols) {
    if (explicitExportsOnly && !isExplicitExport(exported, target)) continue
    const name = exported.getName()
    if (name === 'prototype' && !firstDeclaration(exported) && !firstDeclaration(target)) continue
    const path = [...namespace, name]
    const kind = declarationKind(checker, target)
    if (kind === 'namespace' && isPureNamespaceSymbol(target)) {
      collectExports(
        catalogRoot,
        checker,
        target,
        path,
        output,
        symbols,
        paths,
        issues,
        active,
        explicitExportsOnly,
      )
      continue
    }
    const identity = canonicalSymbolIdentity(catalogRoot, target)
    symbols.set(identity, target)
    const currentPaths = paths.get(identity) ?? []
    currentPaths.push(path)
    paths.set(identity, currentPaths)
    output.push({
      path,
      name,
      declaration: identity,
      kind,
      typeOnly: exportIsTypeOnly(exported, target, kind),
      ...exportSourceModule(catalogRoot, checker, exported),
      location: locationOf(catalogRoot, firstDeclaration(exported) ?? firstDeclaration(target)),
    })
    if (hasNamespaceFacet(target)) {
      collectExports(
        catalogRoot,
        checker,
        target,
        path,
        output,
        symbols,
        paths,
        issues,
        active,
        explicitExportsOnly,
      )
    }
  }
  active.delete(moduleIdentity)
}

function exportSourceModule(
  catalogRoot: string,
  checker: ts.TypeChecker,
  exported: ts.Symbol,
  active = new Set<ts.Symbol>(),
): { readonly sourceModule?: string } {
  if (active.has(exported)) return {}
  active.add(exported)
  for (const declaration of exported.declarations ?? []) {
    const exportDeclaration = ts.isExportSpecifier(declaration)
      ? declaration.parent.parent
      : ts.isExportDeclaration(declaration)
        ? declaration
        : undefined
    const specifier = exportDeclaration?.moduleSpecifier
    if (!specifier || !ts.isStringLiteralLike(specifier)) continue

    const direct = publicPackageSpecifier(specifier.text)
    if (direct) return { sourceModule: direct }

    const moduleSymbol = checker.getSymbolAtLocation(specifier)
    const resolvedModule = moduleSymbol && resolveAlias(checker, moduleSymbol)
    if (
      resolvedModule &&
      (specifier.text.startsWith('.') || symbolWithinCatalog(catalogRoot, resolvedModule))
    ) {
      const exportedName = ts.isExportSpecifier(declaration)
        ? (declaration.propertyName ?? declaration.name).text
        : exported.getName()
      const forwarded = checker
        .getExportsOfModule(resolvedModule)
        .find((candidate) => candidate.getName() === exportedName)
      if (forwarded) {
        const source = exportSourceModule(catalogRoot, checker, forwarded, active)
        if (source.sourceModule) return source
      }
      continue
    }
    const moduleDeclaration = resolvedModule && firstDeclaration(resolvedModule)
    if (!moduleDeclaration) continue
    const coordinate = workspacePackageCoordinate(
      catalogRoot,
      moduleDeclaration.getSourceFile().fileName,
    )
    const sourceModule = coordinate && publicPackageCoordinate(coordinate)
    if (sourceModule) return { sourceModule }
  }
  const resolved = resolveAlias(checker, exported)
  if (resolved !== exported) {
    if (symbolWithinCatalog(catalogRoot, resolved)) return {}
    const declaration = firstDeclaration(resolved)
    const coordinate =
      declaration && workspacePackageCoordinate(catalogRoot, declaration.getSourceFile().fileName)
    const sourceModule = coordinate && publicPackageCoordinate(coordinate)
    if (sourceModule) return { sourceModule }
  }
  return {}
}

function publicPackageSpecifier(specifier: string): string | undefined {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('node:')
  ) {
    return
  }
  return `package:${specifier}`
}

function publicPackageCoordinate(coordinate: string): string | undefined {
  if (!coordinate.startsWith('package:')) return
  const segments = coordinate.slice('package:'.length).split('/')
  const packageSegmentCount = segments[0]?.startsWith('@') ? 2 : 1
  if (segments.length < packageSegmentCount) return
  const packageName = segments.slice(0, packageSegmentCount).join('/')
  let subpath = segments.slice(packageSegmentCount).join('/')
  subpath = subpath
    .replace(/(^|\/)\.spec\/api(?:\.d)?\.[cm]?ts$/, '')
    .replace(/(^|\/)index(?:\.d)?\.[cm]?ts$/, '')
    .replace(/\/$/, '')
  return `package:${packageName}${subpath ? `/${subpath}` : ''}`
}

function compareExportDeclarations(
  leftExport: ts.Symbol,
  leftTarget: ts.Symbol,
  rightExport: ts.Symbol,
  rightTarget: ts.Symbol,
): number {
  const left = firstDeclaration(leftExport) ?? firstDeclaration(leftTarget)
  const right = firstDeclaration(rightExport) ?? firstDeclaration(rightTarget)
  if (!left) return right ? 1 : 0
  if (!right) return -1
  return (
    compare(left.getSourceFile().fileName, right.getSourceFile().fileName) || left.pos - right.pos
  )
}

function isExplicitExport(exported: ts.Symbol, target: ts.Symbol): boolean {
  return [...(exported.declarations ?? []), ...(target.declarations ?? [])].some((declaration) => {
    for (let node: ts.Node | undefined = declaration; node; node = node.parent) {
      if (
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
      ) {
        return true
      }
      if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return true
      if (ts.isSourceFile(node)) break
    }
    return false
  })
}

function deduplicateIssues(issues: readonly ObservationIssue[]): ObservationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}\0${issue.message}\0${issue.location?.file ?? ''}\0${issue.location?.line ?? 0}\0${issue.location?.column ?? 0}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

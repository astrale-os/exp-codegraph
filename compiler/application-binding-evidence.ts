import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

import type {
  ApplicationModuleBindingDependency,
  ApplicationModuleBindingRequest,
} from '../analysis/binding/index.ts'

type IndexedBindingBoundary = ApplicationModuleBindingRequest['target'] & {
  readonly absoluteRoot: string
  readonly entrypoints: ReadonlySet<string>
}

export interface ProjectBindingIndex {
  readonly boundaries: readonly IndexedBindingBoundary[]
  readonly sourcesByOwner: ReadonlyMap<string, readonly ts.SourceFile[]>
}

export function observeDependencies(
  root: string,
  program: ts.Program,
  request: ApplicationModuleBindingRequest,
  index: ProjectBindingIndex,
  exports: readonly { readonly sourceModule?: string; readonly path: readonly string[] }[],
): ApplicationModuleBindingDependency[] {
  const dependencies: ApplicationModuleBindingDependency[] = []
  for (const source of index.sourcesByOwner.get(request.target.id) ?? []) {
    const record = (
      specifier: string,
      node: ts.Node,
      kind: ApplicationModuleBindingDependency['kind'],
      typeOnly: boolean,
    ) => {
      const resolved = resolvedModule(program, node, source)?.resolvedFileName
      const target = resolved ? ownerFromIndex(index.boundaries, resolved) : undefined
      if (target?.id === request.target.id) return
      const position = source.getLineAndCharacterOfPosition(node.getStart(source))
      dependencies.push({
        targetModule: target?.id ?? dependencyTarget(root, specifier, resolved),
        kind,
        sourceFile: portable(relative(root, source.fileName)),
        targetFile: resolved ? portable(relative(root, resolved)) : specifier,
        specifier,
        typeOnly,
        deep: Boolean(target && resolved && !target.entrypoints.has(resolve(resolved))),
        line: position.line + 1,
        column: position.character + 1,
      })
    }
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.importClause
        if (!clause) record(node.moduleSpecifier.text, node.moduleSpecifier, 'side-effect', false)
        else if (clause.isTypeOnly) record(node.moduleSpecifier.text, node.moduleSpecifier, 'type', true)
        else {
          const typeOnly = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
            ? clause.namedBindings.elements.some((element) => element.isTypeOnly)
            : false
          const runtime = Boolean(
            clause.name ||
            (clause.namedBindings &&
              (ts.isNamespaceImport(clause.namedBindings) ||
                clause.namedBindings.elements.some((element) => !element.isTypeOnly))),
          )
          if (runtime) record(node.moduleSpecifier.text, node.moduleSpecifier, 'runtime', false)
          if (typeOnly) record(node.moduleSpecifier.text, node.moduleSpecifier, 'type', true)
        }
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        record(node.moduleSpecifier.text, node.moduleSpecifier, 'api', node.isTypeOnly)
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        record(node.argument.literal.text, node.argument.literal, 'type', true)
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        record(node.arguments[0].text, node.arguments[0], 'dynamic', false)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  for (const exported of exports) {
    if (!exported.sourceModule) continue
    dependencies.push({
      targetModule: packageTarget(exported.sourceModule),
      kind: 'api',
      sourceFile: request.target.entrypoint,
      targetFile: exported.sourceModule,
      specifier: '<public-export>',
      typeOnly: true,
      deep: false,
      line: 1,
      column: 1,
    })
  }
  return [...new Map(dependencies.map((value) => [JSON.stringify(value), value])).values()].sort(
    (left, right) => compare(JSON.stringify(left), JSON.stringify(right)),
  )
}

export function readPackageIntent(moduleRoot: string): {
  readonly declared: readonly string[]
  readonly development: readonly string[]
} {
  let directory = moduleRoot
  while (true) {
    const file = resolve(directory, 'package.json')
    if (existsSync(file)) {
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        const names = (field: string) => Object.keys(
          value[field] && typeof value[field] === 'object' && !Array.isArray(value[field])
            ? (value[field] as Record<string, unknown>)
            : {},
        )
        return {
          declared: [...new Set([
            ...names('dependencies'),
            ...names('optionalDependencies'),
            ...names('peerDependencies'),
          ])].sort(compare),
          development: names('devDependencies').sort(compare),
        }
      } catch {
        return { declared: [], development: [] }
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return { declared: [], development: [] }
    directory = parent
  }
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u

export function observeExpectedErrorCodes(program: ts.Program, file: string): string[] {
  const source = program.getSourceFile(file)
  if (!source) return []
  const codes = new Set<string>()
  const visit = (node: ts.Node): void => {
    for (const tag of ts.getJSDocTags(node)) {
      if (tag.tagName.text !== 'throws') continue
      const comment = typeof tag.comment === 'string'
        ? tag.comment
        : tag.comment?.map((part) => part.text).join('') ?? ''
      for (const code of comment.split(/[\s,]+/u)) if (ERROR_CODE.test(code)) codes.add(code)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...codes].sort(compare)
}

export function observeErrorCodes(
  request: ApplicationModuleBindingRequest,
  index: ProjectBindingIndex,
): string[] {
  const codes = new Set<string>()
  const record = (value: string) => { if (ERROR_CODE.test(value)) codes.add(value) }
  for (const source of index.sourcesByOwner.get(request.target.id) ?? []) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isEnumMember(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) || ts.isNumericLiteral(node.name))
      ) record(node.name.text)
      else if (ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal)) record(node.literal.text)
      else if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)) record(node.initializer.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return [...codes].sort(compare)
}

export function indexProjectBindings(
  root: string,
  program: ts.Program,
  requests: readonly ApplicationModuleBindingRequest[],
): ProjectBindingIndex {
  const boundaries = requests
    .map(({ target }) => ({
      ...target,
      absoluteRoot: resolve(root, target.root),
      entrypoints: new Set(
        [target.entrypoint, ...target.facades, ...target.aliases, ...target.internals]
          .map((path) => resolve(root, path)),
      ),
    }))
    .sort((left, right) =>
      right.absoluteRoot.length - left.absoluteRoot.length || compare(left.id, right.id),
    )
  const sourcesByOwner = new Map<string, ts.SourceFile[]>()
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue
    const owner = ownerFromIndex(boundaries, source.fileName)
    if (!owner) continue
    const sources = sourcesByOwner.get(owner.id) ?? []
    sources.push(source)
    sourcesByOwner.set(owner.id, sources)
  }
  for (const sources of sourcesByOwner.values()) {
    sources.sort((left, right) => compare(left.fileName, right.fileName))
  }
  return { boundaries, sourcesByOwner }
}

export function resolvedModule(
  program: ts.Program,
  specifier: ts.Node,
  source: ts.SourceFile,
): ts.ResolvedModuleFull | undefined {
  return (program as ts.Program & {
    getResolvedModuleFromModuleSpecifier(
      specifier: ts.Node,
      source?: ts.SourceFile,
    ): { readonly resolvedModule?: ts.ResolvedModuleFull } | undefined
  }).getResolvedModuleFromModuleSpecifier(specifier, source)?.resolvedModule
}

function ownerFromIndex(
  boundaries: readonly IndexedBindingBoundary[],
  file: string,
): IndexedBindingBoundary | undefined {
  return boundaries.find((boundary) => within(boundary.absoluteRoot, file))
}

function dependencyTarget(root: string, specifier: string, resolved: string | undefined): string {
  if (specifier.startsWith('node:')) return `platform:${specifier}`
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#')) {
    return `package:${packageName(specifier)}`
  }
  if (resolved) {
    const marker = `${sep}node_modules${sep}`
    const index = resolved.lastIndexOf(marker)
    if (index >= 0) return `package:${packageName(resolved.slice(index + marker.length).split(sep).join('/'))}`
    return `unowned:${portable(relative(root, resolved))}`
  }
  return `unowned:${specifier}`
}

function packageTarget(coordinate: string): string {
  return coordinate.startsWith('package:')
    ? `package:${packageName(coordinate.slice('package:'.length))}`
    : coordinate
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier
}

function within(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

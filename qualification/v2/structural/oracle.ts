import { createHash } from 'node:crypto'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

/** Qualification-only oracle. The product consumer never loads this compiler. */
export interface OracleLocation {
  readonly path: string
  readonly start: number
  readonly end: number
  readonly text: string
}

export interface OracleImport extends OracleLocation {
  readonly kind: 'import' | 'export' | 'dynamic'
  readonly specifier?: string
  readonly typeOnly: boolean
  readonly targetPath?: string
}

export function createStructuralOracle(root: string) {
  const configPath = resolve(root, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath)
  if (parsed.errors.length) throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()
  const sources = program.getSourceFiles().filter((source) => parsed.fileNames.includes(source.fileName))
  const pathOf = (filename: string) => relative(root, filename).replaceAll('\\', '/')
  const location = (node: ts.Node): OracleLocation => {
    const source = node.getSourceFile()
    return { path: pathOf(source.fileName), start: node.getStart(source), end: node.getEnd(), text: node.getText(source) }
  }
  const canonical = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
    const visited = new Set<ts.Symbol>()
    while (symbol && symbol.flags & ts.SymbolFlags.Alias && !visited.has(symbol)) {
      visited.add(symbol)
      symbol = checker.getAliasedSymbol(symbol)
    }
    return symbol
  }

  return {
    sources: () => sources.map((source) => ({ path: pathOf(source.fileName), digest: createHash('sha256').update(source.text).digest('hex') })).sort((a, b) => a.path.localeCompare(b.path)),
    exports(path: string) {
      const source = program.getSourceFile(resolve(root, path))
      const module = source && checker.getSymbolAtLocation(source)
      if (!module) throw new Error(`Oracle module missing: ${path}`)
      return checker.getExportsOfModule(module).map((symbol) => ({
        name: symbol.name,
        declarations: (canonical(symbol)?.declarations ?? []).map((declaration) => {
          const name = (declaration as ts.NamedDeclaration).name
          return location(name ?? declaration)
        }).sort(orderLocations),
      })).sort((a, b) => a.name.localeCompare(b.name))
    },
    references(path: string, name: string, includeDeclarations = false): readonly OracleLocation[] {
      const source = program.getSourceFile(resolve(root, path))
      if (!source) throw new Error(`Oracle source missing: ${path}`)
      let declaration: ts.Identifier | undefined
      const find = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === name && (node.parent as ts.NamedDeclaration).name === node && !declaration) declaration = node
        ts.forEachChild(node, find)
      }
      find(source)
      if (!declaration) throw new Error(`Oracle declaration missing: ${path}:${name}`)
      const target = canonical(checker.getSymbolAtLocation(declaration))
      if (!target) throw new Error(`Oracle symbol missing: ${path}:${name}`)
      const result: OracleLocation[] = []
      for (const file of sources) {
        const visit = (node: ts.Node) => {
          if (ts.isIdentifier(node) && (includeDeclarations || node !== declaration)) {
            const symbol = ts.isShorthandPropertyAssignment(node.parent)
              ? checker.getShorthandAssignmentValueSymbol(node.parent)
              : checker.getSymbolAtLocation(node)
            if (canonical(symbol) === target) result.push(location(node))
          }
          ts.forEachChild(node, visit)
        }
        visit(file)
      }
      return result.sort(orderLocations)
    },
    imports(): readonly OracleImport[] {
      const result: OracleImport[] = []
      for (const file of sources) {
        const add = (node: ts.Expression, kind: OracleImport['kind'], typeOnly: boolean) => {
          const specifier = ts.isStringLiteralLike(node) ? node.text : undefined
          const resolved = specifier === undefined ? undefined : ts.resolveModuleName(specifier, file.fileName, parsed.options, ts.sys).resolvedModule
          result.push({ ...location(node), kind, typeOnly, ...(specifier === undefined ? {} : { specifier }), ...(resolved ? { targetPath: pathOf(resolved.resolvedFileName) } : {}) })
        }
        const visit = (node: ts.Node) => {
          if (ts.isImportDeclaration(node)) {
            const clause = node.importClause
            const bindings = clause?.namedBindings
            const typeOnly = !!clause?.isTypeOnly || !!(bindings && ts.isNamedImports(bindings) && !clause?.name && bindings.elements.length && bindings.elements.every((element) => element.isTypeOnly))
            add(node.moduleSpecifier, 'import', typeOnly)
          } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            const clause = node.exportClause
            const typeOnly = node.isTypeOnly || !!(clause && ts.isNamedExports(clause) && clause.elements.length && clause.elements.every((element) => element.isTypeOnly))
            add(node.moduleSpecifier, 'export', typeOnly)
          } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
            add(node.arguments[0], 'dynamic', false)
          }
          ts.forEachChild(node, visit)
        }
        visit(file)
      }
      return result.sort(orderLocations)
    },
  }
}

export function orderLocations(a: Pick<OracleLocation, 'path' | 'start' | 'end'>, b: Pick<OracleLocation, 'path' | 'start' | 'end'>): number {
  return a.path.localeCompare(b.path) || a.start - b.start || a.end - b.end
}

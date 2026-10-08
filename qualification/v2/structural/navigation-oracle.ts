import { relative, resolve } from 'node:path'
import ts from 'typescript'

export interface NavigationOracleLocation {
  readonly path: string
  readonly start: number
  readonly end: number
}

export function createNavigationOracle(root: string) {
  const configPath = resolve(root, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath)
  if (parsed.errors.length) throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()
  const sources = program.getSourceFiles().filter((source) => parsed.fileNames.includes(source.fileName) && !source.isDeclarationFile)
  const owned = new Set(sources)
  const pathOf = (filename: string) => relative(root, filename).replaceAll('\\', '/')
  const location = (node: ts.Node): NavigationOracleLocation => ({
    path: pathOf(node.getSourceFile().fileName), start: node.getStart(node.getSourceFile()), end: node.getEnd(),
  })
  const canonical = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
    const seen = new Set<ts.Symbol>()
    while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
      seen.add(symbol)
      symbol = checker.getAliasedSymbol(symbol)
    }
    return symbol
  }
  const tokens = (source: ts.SourceFile) => {
    const result: ts.Node[] = []
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)
        || ((ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node)) {
        result.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return result
  }
  const targetOf = (node: ts.Node) => canonical(ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node))

  return {
    symbolAt(path: string, offset: number) {
      const source = program.getSourceFile(resolve(root, path))
      if (!source || !owned.has(source)) throw new Error(`Oracle source unavailable: ${path}`)
      const candidates = tokens(source).filter((node) => node.getStart(source) <= offset && offset < node.getEnd())
      candidates.sort((a, b) => (a.getEnd() - a.getStart(source)) - (b.getEnd() - b.getStart(source)))
      const token = candidates[0]
      if (!token) return { sites: [], symbols: [], references: [] }
      const target = targetOf(token)
      if (!target) return { sites: [location(token)], symbols: [], references: [] }
      const declarations = (target.declarations ?? []).filter((node) => owned.has(node.getSourceFile())).map(location).sort(orderNavigationLocations)
      const privateName = target.declarations?.map((node) => (node as ts.NamedDeclaration).name).find((name) => name && ts.isPrivateIdentifier(name))
      const name = privateName ? privateName.getText() : target.name
      const references: NavigationOracleLocation[] = []
      for (const file of sources) for (const node of tokens(file)) {
        if (targetOf(node) !== target) continue
        const isDeclaration = target.declarations?.some((declaration) => (declaration as ts.NamedDeclaration).name === node)
        if (!isDeclaration) references.push(location(node))
      }
      return { sites: [location(token)], symbols: [{ name, declarations }], references: references.sort(orderNavigationLocations) }
    },
  }
}

export function orderNavigationLocations(a: NavigationOracleLocation, b: NavigationOracleLocation): number {
  return a.path.localeCompare(b.path) || a.start - b.start || a.end - b.end
}

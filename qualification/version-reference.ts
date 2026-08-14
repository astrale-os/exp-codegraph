import ts from 'typescript'

import type { Diagnostic } from '../source/diagnostic.ts'

export interface VersionReferenceSource {
  readonly file: string
  readonly text: string
}

export interface VersionReferenceTerm {
  readonly name: string
  readonly current: number
  readonly patterns: readonly RegExp[]
  readonly roots?: readonly string[]
}

/** Find stale active-version prose while allowing nearby reason-bearing history annotations. */
export function staleVersionReferences(
  sources: readonly VersionReferenceSource[],
  terms: readonly VersionReferenceTerm[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    const sourcePatterns = terms
      .filter((term) => !term.roots || term.roots.some((root) => source.file.startsWith(root)))
      .flatMap((term) => term.patterns)
    for (const term of terms) {
      if (term.roots && !term.roots.some((root) => source.file.startsWith(root))) continue
      for (const configured of term.patterns) {
        const pattern = new RegExp(
          configured.source,
          configured.flags.includes('g') ? configured.flags : `${configured.flags}g`,
        )
        for (const match of source.text.matchAll(pattern)) {
          const version = Number(match.groups?.version)
          if (!Number.isSafeInteger(version) || version === term.current) continue
          const offset = match.index ?? 0
          const position = sourcePosition(source.text, offset)
          if (historicalReference(source.text, position.line, sourcePatterns)) continue
          const key = `${source.file}:${offset}:${term.name}`
          if (seen.has(key)) continue
          seen.add(key)
          diagnostics.push({
            code: 'VERSION_REFERENCE_STALE',
            message: `${match[0]} is stale; ${term.name} currently resolves to V${term.current}. Add a nearby @version-history reason only when the older coordinate is intentional.`,
            file: source.file,
            line: position.line,
            column: position.column,
          })
        }
      }
    }
  }
  return diagnostics.sort(
    (left, right) =>
      compare(left.file, right.file) || left.line - right.line || left.column - right.column,
  )
}

/** Identify active convention-profile source paths, including a repository-root module. */
export function isSpecificationSourcePath(file: string): boolean {
  return (
    (file.startsWith('.spec/') || file.includes('/.spec/')) && /\.(?:d\.ts|ts|md|json)$/u.test(file)
  )
}

/** Read a numeric or v-prefixed literal from a declaration or one of its members. */
export function declarationLiteralVersion(file: string, text: string, selector: string): number {
  const [declarationName, memberName] = selector.split('.')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const matches: Array<number | undefined> = []
  for (const statement of source.statements) {
    if (
      memberName &&
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === declarationName
    ) {
      const member = ts.isTypeLiteralNode(statement.type)
        ? statement.type.members.find(
            (candidate): candidate is ts.PropertySignature =>
              ts.isPropertySignature(candidate) && propertyName(candidate.name) === memberName,
          )
        : undefined
      matches.push(member?.type ? versionLiteral(member.type) : undefined)
    }
    if (!memberName && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== declarationName)
          continue
        matches.push(declaration.type ? versionLiteral(declaration.type) : undefined)
      }
    }
  }
  if (matches.length === 1 && matches[0] !== undefined) return matches[0]
  throw new Error(`Version authority ${selector} is not one numeric literal in ${file}.`)
}

function versionLiteral(node: ts.TypeNode): number | undefined {
  if (!ts.isLiteralTypeNode(node)) return
  const literal = node.literal
  if (ts.isNumericLiteral(literal)) return validVersion(Number(literal.text))
  if (ts.isStringLiteral(literal)) {
    const match = /^v(?<version>\d+)$/u.exec(literal.text)
    if (match?.groups) return validVersion(Number(match.groups.version))
  }
}

function validVersion(value: number): number | undefined {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function propertyName(name: ts.PropertyName | undefined): string | undefined {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined
}

function historicalReference(text: string, line: number, patterns: readonly RegExp[]): boolean {
  const lines = text.split('\n')
  const current = line - 1
  for (let index = current; index >= Math.max(0, current - 4); index--) {
    if (!/@version-history\s*:\s*\S/u.test(lines[index]!)) continue
    const intervening = lines.slice(index + 1, current).join('\n')
    return !patterns.some((configured) => {
      const pattern = new RegExp(configured.source, configured.flags.replaceAll('g', ''))
      return pattern.test(intervening)
    })
  }
  return false
}

function sourcePosition(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

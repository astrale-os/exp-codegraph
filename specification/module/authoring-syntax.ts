import ts from 'typescript'

import type { Diagnostic } from '../../source/diagnostic.ts'
import { operationAuthoringSyntaxSource } from './authoring-syntax.optimization.ts'

export const AUTHORING_SPECIFIER = '@astrale-os/codegraph/authoring'
/** Temporary source-compatible spelling retained while repositories migrate to Codegraph. */
export const AUTHORING_SPECIFIER_ALIASES = [
  AUTHORING_SPECIFIER,
  '@astrale-os/spec/authoring',
] as const

export function isAuthoringSpecifier(value: string): boolean {
  return (AUTHORING_SPECIFIER_ALIASES as readonly string[]).includes(value)
}

export function authoringHelperBinding(file: ts.SourceFile, imported: string): string | undefined {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isAuthoringSpecifier(statement.moduleSpecifier.text)
    )
      continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const binding of bindings.elements) {
      if ((binding.propertyName?.text ?? binding.name.text) === imported) return binding.name.text
    }
  }
  return
}

/** Resolve one statically inspectable helper call without evaluating authoring code. */
export function calledObjectLiteral(
  expression: ts.Expression,
  helper: string | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (
    !helper ||
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== helper ||
    expression.arguments.length !== 1
  )
    return
  const argument = expression.arguments[0]
  return argument && ts.isObjectLiteralExpression(argument) ? argument : undefined
}

export function literalProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) && literalPropertyName(member.name) === name,
  )
}

export function literalPropertyName(name: ts.PropertyName): string | undefined {
  if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return
  const value = name.text
  return value.trim() === value && value && value !== '__proto__' ? value : undefined
}

export function plainStringLiteral(expression: ts.Expression): string | undefined {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined
}

/** Reuse an admitted compiler-universe AST or parse the standalone authored source exactly once. */
export function authoredSourceFile(source: string, text: string): ts.SourceFile {
  return operationAuthoringSyntaxSource(source, text) ??
    ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

export function syntaxDiagnostics(source: string, text: string): Diagnostic[] {
  const admitted = operationAuthoringSyntaxSource(source, text) as
    | (ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
    | undefined
  if (admitted?.parseDiagnostics) {
    return admitted.parseDiagnostics
      .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
      .map((entry) => compilerDiagnostic(source, entry))
  }
  const result = ts.transpileModule(text, {
    fileName: source,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 },
  })
  return (result.diagnostics ?? [])
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
    .map((entry) => compilerDiagnostic(source, entry))
}

function compilerDiagnostic(source: string, entry: ts.Diagnostic): Diagnostic {
  const position =
    entry.file && entry.start !== undefined
      ? entry.file.getLineAndCharacterOfPosition(entry.start)
      : undefined
  return {
    code: `MODULE_TYPESCRIPT_${entry.code}`,
    message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
    file: source,
    line: (position?.line ?? 0) + 1,
    column: (position?.character ?? 0) + 1,
  }
}

export function nodeDiagnostic(
  code: string,
  message: string,
  source: string,
  file: ts.SourceFile,
  node: ts.Node,
): Diagnostic {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file))
  return { code, message, file: source, line: position.line + 1, column: position.character + 1 }
}

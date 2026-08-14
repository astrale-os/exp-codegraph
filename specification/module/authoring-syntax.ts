import ts from 'typescript'

import type { Diagnostic } from '../../source/diagnostic.ts'

export const AUTHORING_SPECIFIER = '@astrale-os/codegraph/authoring'

export function authoringHelperBinding(file: ts.SourceFile, imported: string): string | undefined {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== AUTHORING_SPECIFIER
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

export function syntaxDiagnostics(source: string, text: string): Diagnostic[] {
  const result = ts.transpileModule(text, {
    fileName: source,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 },
  })
  return (result.diagnostics ?? [])
    .filter((entry) => entry.category === ts.DiagnosticCategory.Error)
    .map((entry) => {
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
    })
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

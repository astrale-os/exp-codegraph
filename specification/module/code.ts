import ts from 'typescript'

import type { CodeConfiguration } from '../../authoring/code.ts'
import type { Diagnostic } from '../../source/diagnostic.ts'

import {
  AUTHORING_SPECIFIER,
  authoringHelperBinding,
  calledObjectLiteral,
  literalProperty,
  literalPropertyName,
  nodeDiagnostic,
  plainStringLiteral,
  syntaxDiagnostics,
} from './authoring-syntax.ts'

export interface CodeCompilation {
  readonly configuration?: CodeConfiguration
  readonly diagnostics: readonly Diagnostic[]
}

/** Extract the deliberately small convention-profile code extension without executing it. */
export function compileCode(source: string, text: string): CodeCompilation {
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const diagnostics = syntaxDiagnostics(source, text)
  const helper = authoringHelperBinding(file, 'defineCode')
  const assignments: ts.ExportAssignment[] = []

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      validateImport(statement, source, file, diagnostics)
      continue
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      assignments.push(statement)
      continue
    }
    diagnostics.push(
      nodeDiagnostic(
        'CODE_STATEMENT_INVALID',
        'code.ts may contain only a defineCode import and one default export.',
        source,
        file,
        statement,
      ),
    )
  }

  if (assignments.length !== 1) {
    diagnostics.push({
      code: assignments.length ? 'CODE_EXPORT_AMBIGUOUS' : 'CODE_DEFINITION_MISSING',
      message: 'code.ts must default-export exactly one defineCode literal.',
      file: source,
      line: 1,
      column: 1,
    })
  }
  const assignment = assignments[0]
  const object = assignment ? calledObjectLiteral(assignment.expression, helper) : undefined
  if (!object) {
    if (assignment) {
      diagnostics.push(
        nodeDiagnostic(
          'CODE_DEFINITION_INVALID',
          'The default export must call defineCode with one object literal.',
          source,
          file,
          assignment,
        ),
      )
    }
    return { diagnostics }
  }

  for (const member of object.properties) {
    const name = ts.isPropertyAssignment(member) ? literalPropertyName(member.name) : undefined
    if (name !== 'internals') {
      diagnostics.push(
        nodeDiagnostic(
          'CODE_FIELD_UNKNOWN',
          'Code declarations may contain only internals.',
          source,
          file,
          member,
        ),
      )
    }
  }

  const member = literalProperty(object, 'internals')
  if (!member || !ts.isArrayLiteralExpression(member.initializer)) {
    diagnostics.push(
      nodeDiagnostic(
        'CODE_INTERNALS_INVALID',
        'internals must be a non-empty array of relative POSIX file paths.',
        source,
        file,
        member ?? object,
      ),
    )
    return { diagnostics }
  }

  const internals: string[] = []
  for (const element of member.initializer.elements) {
    const value = plainStringLiteral(element)
    if (!value || !validCodePath(value)) {
      diagnostics.push(
        nodeDiagnostic(
          'CODE_INTERNAL_PATH_INVALID',
          'Internal code paths must be canonical relative POSIX paths without glob syntax.',
          source,
          file,
          element,
        ),
      )
      continue
    }
    if (internals.includes(value)) {
      diagnostics.push(
        nodeDiagnostic(
          'CODE_INTERNAL_PATH_DUPLICATE',
          `Internal code path ${value} is declared more than once.`,
          source,
          file,
          element,
        ),
      )
      continue
    }
    internals.push(value)
  }
  if (member.initializer.elements.length === 0) {
    diagnostics.push(
      nodeDiagnostic(
        'CODE_INTERNALS_EMPTY',
        'Remove code.ts when no shared internal entrypoint is required.',
        source,
        file,
        member.initializer,
      ),
    )
  }

  return {
    ...(internals.length ? { configuration: { internals } } : {}),
    diagnostics,
  }
}

function validateImport(
  statement: ts.ImportDeclaration,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): void {
  const bindings = statement.importClause?.namedBindings
  const valid =
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === AUTHORING_SPECIFIER &&
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length === 1 &&
    (bindings.elements[0]?.propertyName?.text ?? bindings.elements[0]?.name.text) === 'defineCode'
  if (!valid) {
    diagnostics.push(
      nodeDiagnostic(
        'CODE_IMPORT_INVALID',
        `code.ts may import only defineCode from ${AUTHORING_SPECIFIER}.`,
        source,
        file,
        statement,
      ),
    )
  }
}

function validCodePath(value: string): boolean {
  if (
    value.trim() !== value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[*?\[\]{}]/u.test(value)
  )
    return false
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.')) return false
  const firstConcrete = segments.findIndex((segment) => segment !== '..')
  return firstConcrete >= 0 && segments.slice(firstConcrete).every((segment) => segment !== '..')
}

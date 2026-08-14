import ts from 'typescript'

import type { PackagePatternDefinition } from '../../authoring/index.ts'
import type { PackageDependencyDefinition } from '../../authoring/index.ts'
import type { Diagnostic } from '../../source/diagnostic.ts'

import { isPackageName } from '../../source/package-name.ts'
import {
  AUTHORING_SPECIFIER,
  authoringHelperBinding,
  calledObjectLiteral as callObject,
  literalProperty as property,
  literalPropertyName as propertyName,
  nodeDiagnostic,
  plainStringLiteral as stringLiteral,
  syntaxDiagnostics,
} from './authoring-syntax.ts'

export interface PackageCompilation {
  readonly definition?: PackageDependencyDefinition
  readonly diagnostics: readonly Diagnostic[]
}

export interface PackagePatternCompilation {
  readonly definitions: readonly PackagePatternDefinition[]
  readonly diagnostics: readonly Diagnostic[]
}

export function compilePackageDefinition(source: string, text: string): PackageCompilation {
  const parsed = parseModule(source, text, 'definePackage')
  const diagnostics = [...parsed.diagnostics]
  const assignment = oneExportAssignment(parsed.file, source, diagnostics)
  const object = assignment ? callObject(assignment.expression, parsed.helper) : undefined
  if (!assignment || !object) {
    diagnostics.push({
      code: 'PACKAGE_DEFINITION_MISSING',
      message: 'A package file must default-export one definePackage literal.',
      file: source,
      line: 1,
      column: 1,
    })
    return { diagnostics }
  }
  unknownProperties(object, new Set(['package', 'purpose']), source, parsed.file, diagnostics)
  const name = requiredString(object, 'package', source, parsed.file, diagnostics)
  const purpose = requiredString(object, 'purpose', source, parsed.file, diagnostics)
  if (name && !isPackageName(name)) {
    diagnostics.push(
      nodeDiagnostic(
        'PACKAGE_NAME_INVALID',
        `Invalid package name: ${name}`,
        source,
        parsed.file,
        property(object, 'package') ?? object,
      ),
    )
  }
  return {
    ...(name && purpose ? { definition: { package: name, purpose } } : {}),
    diagnostics,
  }
}

export function compilePackagePatterns(source: string, text: string): PackagePatternCompilation {
  const parsed = parseModule(source, text, 'definePackagePattern')
  const diagnostics = [...parsed.diagnostics]
  const assignment = oneExportAssignment(parsed.file, source, diagnostics)
  if (!assignment || !ts.isArrayLiteralExpression(assignment.expression)) {
    diagnostics.push({
      code: 'PACKAGE_PATTERNS_MISSING',
      message: 'packages/exceptions.ts must default-export an array of definePackagePattern calls.',
      file: source,
      line: 1,
      column: 1,
    })
    return { definitions: [], diagnostics }
  }
  if (assignment.expression.elements.length === 0) {
    diagnostics.push({
      code: 'PACKAGE_PATTERNS_EMPTY',
      message: 'Remove packages/exceptions.ts when no package exceptions are required.',
      file: source,
      line: 1,
      column: 1,
    })
  }
  const definitions: PackagePatternDefinition[] = []
  for (const element of assignment.expression.elements) {
    const object = callObject(element, parsed.helper)
    if (!object) {
      diagnostics.push(
        nodeDiagnostic(
          'PACKAGE_PATTERN_INVALID',
          'Every package exception must be a literal definePackagePattern call.',
          source,
          parsed.file,
          element,
        ),
      )
      continue
    }
    unknownProperties(object, new Set(['pattern', 'reason']), source, parsed.file, diagnostics)
    const pattern = requiredString(object, 'pattern', source, parsed.file, diagnostics)
    const reason = requiredString(object, 'reason', source, parsed.file, diagnostics)
    if (pattern && !isPackagePattern(pattern)) {
      diagnostics.push(
        nodeDiagnostic(
          'PACKAGE_PATTERN_UNSAFE',
          'Package patterns must contain one terminal wildcard after a non-global package prefix.',
          source,
          parsed.file,
          property(object, 'pattern') ?? object,
        ),
      )
    }
    if (pattern && reason) definitions.push({ pattern, reason })
  }
  const seen = new Set<string>()
  for (const definition of definitions) {
    if (seen.has(definition.pattern)) {
      diagnostics.push({
        code: 'PACKAGE_PATTERN_DUPLICATE',
        message: `Package pattern ${definition.pattern} is declared more than once.`,
        file: source,
        line: 1,
        column: 1,
      })
    }
    seen.add(definition.pattern)
  }
  return { definitions, diagnostics }
}

export function packageNameFromPath(relativePath: string): string | undefined {
  if (!relativePath.startsWith('packages/') || !relativePath.endsWith('.ts')) return
  const name = relativePath.slice('packages/'.length, -'.ts'.length)
  return isPackageName(name) ? name : undefined
}

export function matchesPackagePattern(pattern: string, packageName: string): boolean {
  return isPackagePattern(pattern) && packageName.startsWith(pattern.slice(0, -1))
}

interface ParsedModule {
  readonly file: ts.SourceFile
  readonly helper?: string
  readonly diagnostics: readonly Diagnostic[]
}

function parseModule(source: string, text: string, imported: string): ParsedModule {
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const diagnostics = syntaxDiagnostics(source, text)
  const helper = authoringHelperBinding(file, imported)
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== AUTHORING_SPECIFIER
      ) {
        diagnostics.push(
          nodeDiagnostic(
            'PACKAGE_IMPORT_INVALID',
            `Package files may import only ${AUTHORING_SPECIFIER}.`,
            source,
            file,
            statement,
          ),
        )
        continue
      }
      continue
    }
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) {
      diagnostics.push(
        nodeDiagnostic(
          'PACKAGE_STATEMENT_INVALID',
          'Package files may contain only an authoring import and one default export.',
          source,
          file,
          statement,
        ),
      )
    }
  }
  return { file, helper, diagnostics }
}

function oneExportAssignment(
  file: ts.SourceFile,
  source: string,
  diagnostics: Diagnostic[],
): ts.ExportAssignment | undefined {
  const assignments = file.statements.filter(ts.isExportAssignment)
  if (assignments.length > 1) {
    diagnostics.push(
      nodeDiagnostic(
        'PACKAGE_EXPORT_AMBIGUOUS',
        'Package definition files must contain exactly one default export.',
        source,
        file,
        assignments[1]!,
      ),
    )
  }
  return assignments.length === 1 ? assignments[0] : undefined
}

function requiredString(
  object: ts.ObjectLiteralExpression,
  name: string,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): string | undefined {
  const member = property(object, name)
  const value = member ? stringLiteral(member.initializer) : undefined
  if (!member || !value || value.trim() !== value) {
    diagnostics.push(
      nodeDiagnostic(
        'PACKAGE_FIELD_INVALID',
        `Package field ${name} must be a non-empty, trimmed string literal.`,
        source,
        file,
        member ?? object,
      ),
    )
    return
  }
  return value
}

function unknownProperties(
  object: ts.ObjectLiteralExpression,
  allowed: ReadonlySet<string>,
  source: string,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
): void {
  for (const member of object.properties) {
    const name = ts.isPropertyAssignment(member) ? propertyName(member.name) : undefined
    if (!name || !allowed.has(name)) {
      diagnostics.push(
        nodeDiagnostic(
          'PACKAGE_FIELD_UNKNOWN',
          'Package definitions may contain only their documented literal fields.',
          source,
          file,
          member,
        ),
      )
    }
  }
}

function isPackagePattern(pattern: string): boolean {
  if (pattern === '*' || !pattern.endsWith('*') || pattern.slice(0, -1).includes('*')) return false
  const prefix = pattern.slice(0, -1)
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(prefix)
}

import type { ErrorObject, ValidateFunction } from 'ajv'
import type { Document, LineCounter } from 'yaml'

import { errorDiagnostic, type Diagnostic } from '../source/diagnostic.ts'
import { sourcePosition } from '../source/yaml.ts'

const DIALECT = /^https:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/

export function validateData(
  data: unknown,
  validate: ValidateFunction,
  file: string,
  document: Document,
  lines: LineCounter,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  try {
    const valid = validate(JSON.parse(JSON.stringify(data)))
    if (typeof valid !== 'boolean') {
      void Promise.resolve(valid).catch(() => undefined)
      throw new Error('Schema validation must be synchronous.')
    }
    if (valid) return diagnostics
    for (const error of validate.errors ?? []) {
      const pointer = errorPointer(error)
      const position = sourcePosition(document, lines, pointer)
      diagnostics.push({
        code: `SCHEMA_${diagnosticKeyword(error.keyword)}`,
        message: error.message ?? `must satisfy ${error.keyword}`,
        file,
        line: position.line,
        column: position.column,
        pointer,
      })
    }
  } catch (error) {
    diagnostics.push(errorDiagnostic('SCHEMA_VALIDATION_FAILED', error, file))
  }
  return diagnostics
}

export function validateSchemaDocument(
  schema: unknown,
  file: string,
  diagnostics: Diagnostic[],
): void {
  if (typeof schema === 'boolean') return
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    diagnostics.push({
      code: 'SCHEMA_INVALID',
      message: 'Schema root must be an object.',
      file,
      line: 1,
      column: 1,
    })
    return
  }
  const dialect = (schema as Record<string, unknown>).$schema
  if (typeof dialect !== 'string' || !DIALECT.test(dialect)) {
    diagnostics.push({
      code: 'SCHEMA_DIALECT',
      message: 'Only JSON Schema Draft 2020-12 is supported.',
      file,
      line: 1,
      column: 1,
      pointer: '/$schema',
    })
  }
  if ((schema as Record<string, unknown>).$async === true) {
    diagnostics.push({
      code: 'SCHEMA_ASYNC',
      message: 'Async JSON Schemas are not supported.',
      file,
      line: 1,
      column: 1,
      pointer: '/$async',
    })
  }
}

function errorPointer(error: ErrorObject): string {
  const propertyName =
    error.propertyName ??
    (error.keyword === 'propertyNames' ? String(error.params.propertyName) : undefined)
  if (propertyName !== undefined) return `${error.instancePath}/${escapePointer(propertyName)}`
  if (error.keyword === 'required') {
    return `${error.instancePath}/${escapePointer(String(error.params.missingProperty))}`
  }
  if (error.keyword === 'additionalProperties' || error.keyword === 'unevaluatedProperties') {
    const property = error.params.additionalProperty ?? error.params.unevaluatedProperty
    return `${error.instancePath}/${escapePointer(String(property))}`
  }
  return error.instancePath
}

function diagnosticKeyword(keyword: string): string {
  return keyword
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z\d]+/g, '_')
    .toUpperCase()
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

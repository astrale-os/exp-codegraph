import type { Completeness, SourceSpan } from '../../facts/index.ts'
import type { FunctionBodyIR } from '../body/index.ts'
import { validateFunctionBodyIR } from '../body/index.ts'
import type { TypeScriptFactKind } from './model.ts'

export function validateTypeScriptFactPayload(
  kind: TypeScriptFactKind,
  value: unknown,
  schemaVersion = 1,
): readonly string[] {
  const diagnostics: string[] = []
  if (!record(value)) return ['payload:not-object']
  switch (kind) {
    case 'project':
      requireString(value, 'universe', diagnostics)
      requireStrings(value, 'configurationFiles', diagnostics)
      requireStrings(value, 'projectReferences', diagnostics)
      break
    case 'diagnostic':
      if (!Number.isInteger(value.code)) diagnostics.push('code:not-integer')
      if (value.severity !== 'error' && value.severity !== 'warning') diagnostics.push('severity:invalid')
      requireString(value, 'message', diagnostics)
      optionalString(value, 'file', diagnostics)
      optionalSpan(value.span, 'span', diagnostics)
      break
    case 'source':
      for (const key of ['source', 'revision', 'textDigest', 'logicalPath']) {
        requireString(value, key, diagnostics)
      }
      requireBoolean(value, 'declaration', diagnostics)
      requireBoolean(value, 'projectOwned', diagnostics)
      break
    case 'symbol':
      requireString(value, 'symbol', diagnostics)
      requireString(value, 'name', diagnostics)
      requireArray(value, 'declarations', diagnostics, span)
      optionalString(value, 'canonical', diagnostics)
      requireBoolean(value, 'generationScoped', diagnostics)
      break
    case 'occurrence':
      requireString(value, 'occurrence', diagnostics)
      if (!['import', 'export', 'access', 'construction', 'render', 'call', 'other'].includes(String(value.kind))) {
        diagnostics.push('kind:invalid')
      }
      if (!span(value.span)) diagnostics.push('span:invalid')
      optionalString(value, 'target', diagnostics)
      break
    case 'body':
      validateBody(value, diagnostics)
      break
    case 'module':
      validateModule(value, diagnostics, schemaVersion)
      break
    case 'declaration':
      if (!record(value.declaration) || !observedDeclaration(value.declaration)) {
        diagnostics.push('declaration:invalid')
      }
      break
  }
  return [...new Set(diagnostics)].sort()
}

function validateBody(value: Record<string, unknown>, diagnostics: string[]): void {
  if (!bodyShape(value.body)) diagnostics.push('body:invalid-shape')
  else diagnostics.push(...validateFunctionBodyIR(value.body).map((code) => `body:${code}`))
  if (!record(value.values) || Object.values(value.values).some((item) => !valueResult(item))) {
    diagnostics.push('values:invalid')
  }
  if (!completeness(value.completeness)) diagnostics.push('completeness:invalid')
}

function validateModule(
  value: Record<string, unknown>,
  diagnostics: string[],
  schemaVersion: number,
): void {
  if (!record(value.target)) diagnostics.push('target:not-object')
  else {
    for (const key of ['id', 'name', 'project', 'root', 'entrypoint']) {
      requireString(value.target, key, diagnostics, 'target.')
    }
    for (const key of ['facades', 'aliases', 'internals']) {
      requireStrings(value.target, key, diagnostics, 'target.')
    }
  }
  requireArray(value, 'exports', diagnostics, observedExport)
  requireArray(
    value,
    'declarations',
    diagnostics,
    schemaVersion === 2 ? moduleDeclarationReference : observedDeclaration,
  )
  requireArray(value, 'dependencies', diagnostics, dependency)
  requireArray(value, 'inboundDependencies', diagnostics, dependency)
  for (const key of ['declaredPackages', 'developmentPackages', 'workspacePackages', 'files']) {
    requireStrings(value, key, diagnostics)
  }
  requireArray(value, 'errorCodes', diagnostics, errorCode)
  if (!Array.isArray(value.issues) || value.issues.some((issue) => !observationIssue(issue))) {
    diagnostics.push('issues:invalid')
  }
}

function moduleDeclarationReference(value: unknown): boolean {
  return (
    record(value) &&
    string(value.fact) &&
    string(value.identity) &&
    Array.isArray(value.exportPaths) &&
    value.exportPaths.every(strings)
  )
}

function bodyShape(value: unknown): value is FunctionBodyIR {
  return (
    record(value) &&
    string(value.function) &&
    strings(value.parameters) &&
    Array.isArray(value.occurrences) &&
    Array.isArray(value.relations) &&
    Array.isArray(value.blocks) &&
    Array.isArray(value.edges) &&
    Array.isArray(value.definitions) &&
    Array.isArray(value.calls) &&
    record(value.summary)
  )
}

function observedExport(value: unknown): boolean {
  return (
    record(value) &&
    strings(value.path) &&
    string(value.name) &&
    string(value.declaration) &&
    string(value.kind) &&
    typeof value.typeOnly === 'boolean' &&
    optionalStringValue(value.sourceModule) &&
    location(value.location)
  )
}

function observedDeclaration(value: unknown): boolean {
  return (
    record(value) &&
    string(value.identity) &&
    string(value.name) &&
    string(value.kind) &&
    location(value.location) &&
    Array.isArray(value.exportPaths) &&
    value.exportPaths.every(strings) &&
    strings(value.referencedDeclarations) &&
    Array.isArray(value.issues) &&
    value.issues.every(observationIssue)
  )
}

function dependency(value: unknown): boolean {
  return (
    record(value) &&
    string(value.id) &&
    string(value.sourceModule) &&
    string(value.targetModule) &&
    ['api', 'runtime', 'type', 'side-effect', 'dynamic'].includes(String(value.kind)) &&
    string(value.sourceFile) &&
    string(value.targetFile) &&
    Array.isArray(value.occurrences) &&
    value.occurrences.every(
      (occurrence) =>
        record(occurrence) &&
        string(occurrence.id) &&
        typeof occurrence.typeOnly === 'boolean' &&
        string(occurrence.specifier) &&
        typeof occurrence.deep === 'boolean' &&
        location(occurrence.location) &&
        optionalStringValue(occurrence.declaration) &&
        (occurrence.publicPath === undefined || strings(occurrence.publicPath)),
    )
  )
}

function errorCode(value: unknown): boolean {
  return record(value) && string(value.code) && location(value.location)
}

function observationIssue(value: unknown): boolean {
  return (
    record(value) &&
    string(value.code) &&
    string(value.message) &&
    (value.location === undefined || location(value.location))
  )
}

function location(value: unknown): boolean {
  return (
    record(value) &&
    Number.isSafeInteger(value.line) &&
    Number(value.line) >= 1 &&
    Number.isSafeInteger(value.column) &&
    Number(value.column) >= 1 &&
    ((string(value.file) && value.external === undefined) ||
      (string(value.external) && value.file === undefined))
  )
}

function valueResult(value: unknown): boolean {
  if (!record(value) || !string(value.kind) || !strings(value.evidence)) return false
  switch (value.kind) {
    case 'known':
      return 'value' in value
    case 'unknown':
      return Array.isArray(value.reasons)
    case 'ambiguous':
      return Array.isArray(value.values) && Array.isArray(value.reasons)
    case 'unsupported':
      return string(value.construct)
    default:
      return false
  }
}

function completeness(value: unknown): value is Completeness {
  return (
    record(value) &&
    (value.kind === 'complete' ||
      ((value.kind === 'partial' || value.kind === 'unavailable') &&
        Array.isArray(value.reasons) &&
        value.reasons.every(
          (reason) => record(reason) && string(reason.code) && string(reason.message),
        )))
  )
}

function span(value: unknown): value is SourceSpan {
  return (
    record(value) &&
    string(value.source) &&
    string(value.revision) &&
    Number.isSafeInteger(value.start) &&
    Number(value.start) >= 0 &&
    Number.isSafeInteger(value.end) &&
    Number(value.end) > Number(value.start)
  )
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  diagnostics: string[],
  prefix = '',
): void {
  if (!string(value[key])) diagnostics.push(`${prefix}${key}:not-string`)
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  diagnostics: string[],
): void {
  if (!optionalStringValue(value[key])) diagnostics.push(`${key}:not-optional-string`)
}

function requireBoolean(value: Record<string, unknown>, key: string, diagnostics: string[]): void {
  if (typeof value[key] !== 'boolean') diagnostics.push(`${key}:not-boolean`)
}

function requireStrings(
  value: Record<string, unknown>,
  key: string,
  diagnostics: string[],
  prefix = '',
): void {
  if (!strings(value[key])) diagnostics.push(`${prefix}${key}:not-string-array`)
}

function requireArray(
  value: Record<string, unknown>,
  key: string,
  diagnostics: string[],
  validate: (item: unknown) => boolean,
): void {
  if (!Array.isArray(value[key]) || value[key].some((item) => !validate(item))) {
    diagnostics.push(`${key}:invalid-array`)
  }
}

function optionalSpan(value: unknown, key: string, diagnostics: string[]): void {
  if (value !== undefined && !span(value)) diagnostics.push(`${key}:invalid`)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string)
}

function optionalStringValue(value: unknown): boolean {
  return value === undefined || string(value)
}

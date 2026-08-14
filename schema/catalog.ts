import { Ajv2020 } from 'ajv/dist/2020.js'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Diagnostic } from '../source/diagnostic.ts'

export interface CatalogSchemaResource {
  readonly source: string
  readonly schema: unknown
  /** Stable compiler base used for relative references; diagnostics continue to use source. */
  readonly resolutionBase?: string
}

/** Compile every convention-profile schema as one closed catalog-local JSON Schema set. */
export function validateModuleSchemaCatalog(
  catalogRoot: string,
  resources: readonly CatalogSchemaResource[],
): Diagnostic[] {
  if (!resources.length) return []

  const diagnostics: Diagnostic[] = []
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
  const accepted: { resource: CatalogSchemaResource; key: string }[] = []
  const identities = new Map<string, string>()
  for (const resource of resources) {
    if (!validSchemaValue(resource.schema)) continue
    const identity = schemaIdentity(resource.schema)
    if (identity) {
      const first = identities.get(identity)
      if (first) {
        diagnostics.push({
          code: 'SCHEMA_ID_DUPLICATE',
          message: `JSON Schema identity ${identity} is already declared by ${first}.`,
          file: resource.source,
          line: 1,
          column: 1,
          pointer: '/$id',
        })
        continue
      }
      identities.set(identity, resource.source)
    }
    const key = resource.resolutionBase ?? pathToFileURL(resolve(catalogRoot, resource.source)).href
    try {
      ajv.addSchema(resource.schema as boolean | object, key)
      accepted.push({ resource, key: identity ?? key })
    } catch (error) {
      diagnostics.push(schemaCatalogDiagnostic('SCHEMA_CATALOG_INVALID', error, resource))
    }
  }
  for (const { resource, key } of accepted) {
    try {
      if (!ajv.getSchema(key)) {
        throw new Error(`Schema did not register under its canonical identity: ${key}`)
      }
    } catch (error) {
      diagnostics.push(schemaCatalogDiagnostic('SCHEMA_REFERENCE_UNRESOLVED', error, resource))
    }
  }
  return diagnostics
}

function schemaIdentity(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
  const id = (schema as Record<string, unknown>).$id
  return typeof id === 'string' && id ? id : undefined
}

function validSchemaValue(value: unknown): value is boolean | object {
  return (
    typeof value === 'boolean' ||
    Boolean(value && typeof value === 'object' && !Array.isArray(value))
  )
}

function schemaCatalogDiagnostic(
  code: string,
  error: unknown,
  resource: CatalogSchemaResource,
): Diagnostic {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    file: resource.source,
    line: 1,
    column: 1,
  }
}

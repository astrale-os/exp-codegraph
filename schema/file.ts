import { dirname, relative, resolve, sep } from 'node:path'

import type { Diagnostic } from '../source/diagnostic.ts'

import { loadYaml } from '../source/yaml.ts'
import { loadSchema } from './load.ts'
import { validateData } from './validate.ts'

export interface SchemaFileValidationOptions {
  readonly schema: string
  readonly document: string
  /** Closed root for local schema references. Defaults to the schema directory. */
  readonly root?: string
}

/** Validate one bounded JSON or YAML document against one local Draft 2020-12 schema. */
export async function validateSchemaFile(
  options: SchemaFileValidationOptions,
): Promise<readonly Diagnostic[]> {
  const schema = resolve(options.schema)
  const document = resolve(options.document)
  const root = resolve(options.root ?? dirname(schema))
  const schemaSource = portable(relative(root, schema))
  const documentSource = portable(relative(root, document))
  const loadedSchema = await loadSchema(schema, schemaSource, root)
  if (loadedSchema.diagnostics.length || !loadedSchema.validate) return loadedSchema.diagnostics
  const loadedDocument = await loadYaml(document, documentSource)
  if (loadedDocument.diagnostics.length || !loadedDocument.document || !loadedDocument.lines) {
    return loadedDocument.diagnostics
  }
  return validateData(
    loadedDocument.data,
    loadedSchema.validate,
    documentSource,
    loadedDocument.document,
    loadedDocument.lines,
  )
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

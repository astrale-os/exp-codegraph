import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import { realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'

import { errorDiagnostic, type Diagnostic } from '../source/diagnostic.ts'
import { readBounded } from '../source/file.ts'
import { MAX_VALUE_DEPTH, MAX_VALUE_NODES, valueLimit } from '../source/limits.ts'
import { loadYaml } from '../source/yaml.ts'
import { validateSchemaDocument } from './validate.ts'

export interface SchemaSource {
  text: string
  schema: unknown
  validate?: ValidateFunction
  diagnostics: Diagnostic[]
}

export interface SchemaLoadOptions {
  /** Compile the schema into an instance validator. Defaults to true. */
  readonly compile?: boolean
}

export async function loadSchema(
  file: string,
  source: string,
  root: string,
  additionalSchemas: readonly object[] = [],
  options: SchemaLoadOptions = {},
): Promise<SchemaSource> {
  let text = ''
  let schema: unknown = null
  let validate: ValidateFunction | undefined
  const diagnostics: Diagnostic[] = []
  try {
    text = await readBounded(file)
    const syntax = parseDocument(text, { prettyErrors: false, strict: true, uniqueKeys: true })
    if (syntax.errors.length) throw new Error(syntax.errors[0]?.message)
    const parsed: unknown = JSON.parse(text)
    const limit = valueLimit(parsed)
    if (limit) {
      diagnostics.push({
        code: limit === 'depth' ? 'SCHEMA_DEPTH' : 'SCHEMA_SIZE',
        message:
          limit === 'depth'
            ? `Schema values may be nested at most ${MAX_VALUE_DEPTH} levels.`
            : `Schema values may contain at most ${MAX_VALUE_NODES} nodes.`,
        file: source,
        line: 1,
        column: 1,
      })
    } else {
      schema = parsed
      validateSchemaDocument(schema, source, diagnostics)
    }
    if (!diagnostics.length && options.compile === false) {
      const ajv = configuredAjv(
        { allErrors: true, strict: false, validateFormats: false },
        additionalSchemas,
      )
      if (!ajv.validateSchema(schema as boolean | object)) {
        diagnostics.push({
          code: 'SCHEMA_META_INVALID',
          message: ajv.errorsText(ajv.errors, { separator: '; ' }),
          file: source,
          line: 1,
          column: 1,
        })
      }
    }
    if (!diagnostics.length && options.compile !== false) {
      const options = { allErrors: true, strict: false, validateFormats: false } as const
      const ajv = configuredAjv(options, additionalSchemas)
      try {
        validate = ajv.compile(schema as boolean | object)
      } catch (error) {
        if (typeof schema === 'boolean' || !hasLocalSchemaReference(schema)) throw error
        const asyncAjv = configuredAjv(
          {
            ...options,
            loadSchema: async (uri) => (await loadReferencedSchema(uri, file, root)) as never,
          },
          additionalSchemas,
        )
        validate = await asyncAjv.compileAsync(withFileBase(schema as object, file) as never)
      }
    }
  } catch (error) {
    diagnostics.push(errorDiagnostic('SCHEMA_INVALID', error, source))
  }
  return { text, schema, validate, diagnostics }
}

function configuredAjv(
  options: ConstructorParameters<typeof Ajv2020>[0],
  additionalSchemas: readonly object[],
): Ajv2020 {
  const ajv = new Ajv2020(options)
  for (const schema of additionalSchemas) ajv.addSchema(schema)
  return ajv
}

async function loadReferencedSchema(uri: string, from: string, root: string): Promise<unknown> {
  if ((/^[a-z][a-z\d+.-]*:/i.test(uri) && !uri.startsWith('file:')) || uri.includes('\\')) {
    throw new Error(`Remote or absolute schema references are not supported: ${uri}`)
  }
  const hash = uri.indexOf('#')
  const document = hash === -1 ? uri : uri.slice(0, hash)
  if (!document) throw new Error(`Schema reference has no document: ${uri}`)
  const catalogRoot = await realpath(resolve(root))
  let candidate: string
  if (document.startsWith('file:')) {
    candidate = fileURLToPath(document)
  } else {
    let decoded: string
    try {
      decoded = decodeURIComponent(document)
    } catch {
      throw new Error(`Schema reference contains invalid percent encoding: ${uri}`)
    }
    if (
      isAbsolute(decoded) ||
      decoded.includes('\\') ||
      [...decoded].some((character) => isControl(character.codePointAt(0)!))
    ) {
      throw new Error(`Schema reference must use a relative POSIX path: ${uri}`)
    }
    candidate = resolve(dirname(from), ...decoded.split('/'))
  }
  const target = await realpath(candidate)
  if (!within(catalogRoot, target))
    throw new Error(`Schema reference escapes the catalog root: ${uri}`)
  const source = portable(relative(catalogRoot, target))
  const parsed = await readReferencedSchema(target, source, uri)
  const diagnostics: Diagnostic[] = []
  validateSchemaDocument(parsed, source, diagnostics)
  if (diagnostics.length) throw new Error(diagnostics[0]?.message)
  return parsed
}

async function readReferencedSchema(target: string, source: string, uri: string): Promise<unknown> {
  if (extname(target) === '.json') {
    const text = await readBounded(target)
    const syntax = parseDocument(text, { prettyErrors: false, strict: true, uniqueKeys: true })
    if (syntax.errors.length) throw new Error(syntax.errors[0]?.message)
    const parsed: unknown = JSON.parse(text)
    const limit = valueLimit(parsed)
    if (limit) throw new Error(`Referenced schema exceeds the ${limit} limit.`)
    return parsed
  }
  if (!['.yml', '.yaml'].includes(extname(target))) {
    throw new Error(`Referenced schemas must use .json, .yml, or .yaml: ${uri}`)
  }
  const yaml = await loadYaml(target, source)
  if (yaml.diagnostics.length) throw new Error(yaml.diagnostics[0]?.message)
  return yaml.data
}

function withFileBase(schema: object, file: string): object {
  if (Object.hasOwn(schema, '$id')) return schema
  return { $id: pathToFileURL(file).href, ...schema }
}

function hasLocalSchemaReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLocalSchemaReference)
  if (!value || typeof value !== 'object') return false
  for (const [key, child] of Object.entries(value)) {
    if (
      key === '$ref' &&
      typeof child === 'string' &&
      child !== '' &&
      !child.startsWith('#') &&
      !isAbsolute(child) &&
      !/^[a-z][a-z\d+.-]*:/i.test(child) &&
      !child.includes('\\')
    )
      return true
    if (hasLocalSchemaReference(child)) return true
  }
  return false
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

import type { SchemaResource } from '../../specification/index.ts'

/** One explicitly supplied schema-catalog input, independent of its checkout location. */
export interface ApplicationSchemaDependencyResource {
  readonly source: string
  readonly revision: string
  readonly schema: unknown
  readonly resolutionBase: string
}

/** Rebase one dependency catalog onto a portable virtual URI namespace. */
export function applicationSchemaDependencies(
  ordinal: number,
  schemas: readonly SchemaResource[],
): readonly ApplicationSchemaDependencyResource[] {
  const prefix = `<schema-root:${ordinal + 1}>`
  return schemas
    .map((schema) => ({
      source: `${prefix}/${schema.source}`,
      revision: schema.revision,
      schema: schema.schema,
      resolutionBase: `astrale-schema-root://${ordinal + 1}/${encodeURI(schema.source)}`,
    }))
    .sort((left, right) => left.source.localeCompare(right.source))
}

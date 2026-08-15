/** Rebase one dependency catalog onto a portable virtual URI namespace. */
export function applicationSchemaDependencies(ordinal, schemas) {
    const prefix = `<schema-root:${ordinal + 1}>`;
    return schemas
        .map((schema) => ({
        source: `${prefix}/${schema.source}`,
        revision: schema.revision,
        schema: schema.schema,
        resolutionBase: `astrale-schema-root://${ordinal + 1}/${encodeURI(schema.source)}`,
    }))
        .sort((left, right) => left.source.localeCompare(right.source));
}
//# sourceMappingURL=schema-dependency.js.map
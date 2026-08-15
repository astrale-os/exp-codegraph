import { matchesPackagePattern } from './package.js';
/** Validate relationships that only become visible after all module artifacts are loaded. */
export function validateModuleSemantics(resources) {
    const diagnostics = [];
    validateSemanticIds(resources, diagnostics);
    validateBenchmarks(resources, diagnostics);
    validateSchemaIdentities(resources.schemas, diagnostics);
    validatePackageDefinitions(resources, diagnostics);
    return diagnostics;
}
function validateSemanticIds(resources, diagnostics) {
    const definitions = [
        ...resources.capabilities.flatMap((resource) => resource.definitions.map((definition) => ({ resource, definition }))),
        ...resources.laws.flatMap((resource) => resource.definitions.map((definition) => ({ resource, definition }))),
        ...resources.benchmarks.flatMap((resource) => resource.definitions.map((definition) => ({ resource, definition }))),
    ];
    const seen = new Map();
    for (const { resource, definition } of definitions) {
        const first = seen.get(definition.id);
        if (first) {
            diagnostics.push({
                code: 'SEMANTIC_ID_DUPLICATE',
                message: `Semantic identifier ${definition.id} is already declared by ${first}.`,
                file: resource.source,
                line: 1,
                column: 1,
            });
        }
        else {
            seen.set(definition.id, resource.source);
        }
    }
}
function validateBenchmarks(resources, diagnostics) {
    const capabilities = new Set(resources.capabilities.flatMap((resource) => resource.definitions.map((definition) => definition.id)));
    for (const resource of resources.benchmarks) {
        for (const definition of resource.definitions) {
            if (!definition.capability || capabilities.has(definition.capability))
                continue;
            diagnostics.push({
                code: 'BENCHMARK_CAPABILITY_UNKNOWN',
                message: `Benchmark ${definition.id} references undeclared capability ${definition.capability}.`,
                file: resource.source,
                line: 1,
                column: 1,
            });
        }
    }
}
function validateSchemaIdentities(schemas, diagnostics) {
    const seen = new Map();
    for (const resource of schemas) {
        const id = schemaId(resource.schema);
        if (!id)
            continue;
        const first = seen.get(id);
        if (first) {
            diagnostics.push({
                code: 'SCHEMA_ID_DUPLICATE',
                message: `JSON Schema identity ${id} is already declared by ${first}.`,
                file: resource.source,
                line: 1,
                column: 1,
                pointer: '/$id',
            });
        }
        else {
            seen.set(id, resource.source);
        }
    }
}
function validatePackageDefinitions(resources, diagnostics) {
    const seen = new Map();
    for (const resource of resources.packages) {
        const first = seen.get(resource.package);
        if (first) {
            diagnostics.push({
                code: 'PACKAGE_DEFINITION_DUPLICATE',
                message: `Package ${resource.package} is already specified by ${first}.`,
                file: resource.source,
                line: 1,
                column: 1,
            });
        }
        else {
            seen.set(resource.package, resource.source);
        }
        const pattern = resources.packagePatterns.find((candidate) => matchesPackagePattern(candidate.pattern, resource.package));
        if (pattern) {
            diagnostics.push({
                code: 'PACKAGE_DEFINITION_PATTERN_OVERLAP',
                message: `Package ${resource.package} is declared explicitly and also covered by ${pattern.pattern}.`,
                file: resource.source,
                line: 1,
                column: 1,
            });
        }
    }
}
export function schemaId(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema))
        return;
    const id = schema.$id;
    return typeof id === 'string' && id ? id : undefined;
}
//# sourceMappingURL=semantics.js.map
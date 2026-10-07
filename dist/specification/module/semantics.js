import { locateDescriptorValue } from './descriptor.js';
import { matchesPackagePattern } from './package.js';
/** Validate relationships that only become visible after all module artifacts are loaded. */
export function validateModuleSemantics(resources) {
    const diagnostics = [];
    validateSemanticIds(resources, diagnostics);
    validateBenchmarks(resources, diagnostics);
    validateCapabilityReferences(resources, diagnostics);
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
/** Resolve the citations a capability makes inside its own module; descendants need the catalog. */
function validateCapabilityReferences(resources, diagnostics) {
    const laws = new Set(resources.laws.flatMap((resource) => resource.definitions.map((definition) => definition.id)));
    const capabilities = new Map();
    for (const resource of resources.capabilities) {
        for (const definition of resource.definitions) {
            if (capabilities.has(definition.id))
                continue;
            capabilities.set(definition.id, (definition.capabilities ?? []).filter((reference) => typeof reference === 'string'));
        }
    }
    for (const resource of resources.capabilities) {
        for (const definition of resource.definitions) {
            const located = (field, reference) => ({
                file: resource.source,
                ...locateDescriptorValue(resource.source, resource.text, definition.exportName, [
                    field,
                    { element: reference },
                ]),
            });
            for (const reference of definition.laws ?? []) {
                if (typeof reference !== 'string' || laws.has(reference))
                    continue;
                diagnostics.push({
                    code: 'CAPABILITY_LAW_UNKNOWN',
                    message: `Capability ${definition.id} references undeclared law ${reference}.`,
                    ...located('laws', reference),
                });
            }
            for (const reference of definition.capabilities ?? []) {
                if (typeof reference !== 'string' || capabilities.has(reference))
                    continue;
                diagnostics.push({
                    code: 'CAPABILITY_CAPABILITY_UNKNOWN',
                    message: `Capability ${definition.id} references undeclared capability ${reference}.`,
                    ...located('capabilities', reference),
                });
            }
            // Citations only descend into other modules, so every cycle closes inside this module.
            const cycle = capabilityCycle(definition.id, capabilities);
            if (!cycle)
                continue;
            diagnostics.push({
                code: 'CAPABILITY_CYCLE',
                message: `Capability ${definition.id} reaches itself through capabilities: ${cycle.join(' → ')}.`,
                ...located('capabilities', cycle[1]),
            });
        }
    }
}
/** Shortest citation path leading one capability back to itself, when one exists. */
function capabilityCycle(origin, capabilities) {
    const pending = [[origin]];
    const visited = new Set();
    while (pending.length) {
        const path = pending.shift();
        for (const cited of capabilities.get(path.at(-1)) ?? []) {
            if (cited === origin)
                return [...path, cited];
            if (visited.has(cited) || !capabilities.has(cited))
                continue;
            visited.add(cited);
            pending.push([...path, cited]);
        }
    }
    return;
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

import { resolve } from 'node:path';
import { createGenerator } from 'ts-json-schema-generator';
/**
 * Generate one strict bundled wire schema from explicitly named exported declarations.
 *
 * The declaration API remains authoritative. JSON Schema is a deterministic generated artifact;
 * unsupported TypeScript constructs fail rather than being hidden or approximated.
 */
export async function emitJsonSchema(options) {
    const mainFile = resolve(options.mainFile);
    if (!mainFile.endsWith('.d.ts')) {
        return failure('JSON_SCHEMA_ENTRYPOINT', 'JSON Schema input must be a .d.ts declaration file.');
    }
    if (options.roots.length === 0 || new Set(options.roots).size !== options.roots.length) {
        return failure('JSON_SCHEMA_ROOTS', 'JSON Schema roots must be a non-empty unique list.');
    }
    try {
        const config = {
            path: mainFile,
            type: [...options.roots],
            schemaId: options.bundleId,
            expose: 'export',
            topRef: true,
            jsDoc: 'extended',
            sortProps: true,
            strictTuples: true,
            skipTypeCheck: false,
            encodeRefs: true,
            additionalProperties: false,
            functions: 'fail',
        };
        const generated = createGenerator(config).createSchema([...options.roots]);
        const schema = toDraft202012(generated);
        const definitions = schema.$defs ?? {};
        const missing = options.roots.filter((root) => !Object.hasOwn(definitions, root));
        if (missing.length) {
            return failure('JSON_SCHEMA_ROOT_MISSING', `Generator output omitted named roots: ${missing.join(', ')}.`);
        }
        return { ok: true, schema, diagnostics: [] };
    }
    catch (error) {
        return failure('JSON_SCHEMA_GENERATION_FAILED', error instanceof Error ? error.message : String(error));
    }
}
function toDraft202012(value) {
    if (Array.isArray(value))
        return value.map(toDraft202012);
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string')
            return value.replaceAll('#/definitions/', '#/$defs/');
        return value;
    }
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === '$schema') {
            output.$schema = 'https://json-schema.org/draft/2020-12/schema';
        }
        else if (key === 'definitions') {
            output.$defs = toDraft202012(child);
        }
        else {
            output[key] = toDraft202012(child);
        }
    }
    return output;
}
function failure(code, message) {
    return {
        ok: false,
        diagnostics: [{ source: 'json-schema', code, severity: 'error', message }],
    };
}
//# sourceMappingURL=emit.js.map
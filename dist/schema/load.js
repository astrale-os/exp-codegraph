import { Ajv2020 } from 'ajv/dist/2020.js';
import { realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { errorDiagnostic } from '../source/diagnostic.js';
import { readBounded } from '../source/file.js';
import { MAX_VALUE_DEPTH, MAX_VALUE_NODES, valueLimit } from '../source/limits.js';
import { loadYaml } from '../source/yaml.js';
import { validateSchemaDocument } from './validate.js';
import { schemaMetadataIssue } from './load.optimization.js';
export async function loadSchema(file, source, root, additionalSchemas = [], options = {}) {
    let text = '';
    let schema = null;
    let validate;
    const diagnostics = [];
    try {
        text = await readBounded(file);
        const syntax = parseDocument(text, { prettyErrors: false, strict: true, uniqueKeys: true });
        if (syntax.errors.length)
            throw new Error(syntax.errors[0]?.message);
        const parsed = JSON.parse(text);
        const limit = valueLimit(parsed);
        if (limit) {
            diagnostics.push({
                code: limit === 'depth' ? 'SCHEMA_DEPTH' : 'SCHEMA_SIZE',
                message: limit === 'depth'
                    ? `Schema values may be nested at most ${MAX_VALUE_DEPTH} levels.`
                    : `Schema values may contain at most ${MAX_VALUE_NODES} nodes.`,
                file: source,
                line: 1,
                column: 1,
            });
        }
        else {
            schema = parsed;
            validateSchemaDocument(schema, source, diagnostics);
        }
        if (!diagnostics.length && options.compile === false) {
            const issue = metadataIssue(schema, additionalSchemas);
            if (issue) {
                diagnostics.push({
                    code: 'SCHEMA_META_INVALID',
                    message: issue,
                    file: source,
                    line: 1,
                    column: 1,
                });
            }
        }
        if (!diagnostics.length && options.compile !== false) {
            const options = { allErrors: true, strict: false, validateFormats: false };
            const ajv = configuredAjv(options, additionalSchemas);
            try {
                validate = ajv.compile(schema);
            }
            catch (error) {
                if (typeof schema === 'boolean' || !hasLocalSchemaReference(schema))
                    throw error;
                const asyncAjv = configuredAjv({
                    ...options,
                    loadSchema: async (uri) => (await loadReferencedSchema(uri, file, root)),
                }, additionalSchemas);
                validate = await asyncAjv.compileAsync(withFileBase(schema, file));
            }
        }
    }
    catch (error) {
        diagnostics.push(errorDiagnostic('SCHEMA_INVALID', error, source));
    }
    return { text, schema, validate, diagnostics };
}
function metadataIssue(schema, additionalSchemas) {
    if (!additionalSchemas.length)
        return schemaMetadataIssue(schema);
    const ajv = configuredAjv({ allErrors: true, strict: false, validateFormats: false }, additionalSchemas);
    if (ajv.validateSchema(schema))
        return;
    return ajv.errorsText(ajv.errors, { separator: '; ' });
}
function configuredAjv(options, additionalSchemas) {
    const ajv = new Ajv2020(options);
    for (const schema of additionalSchemas)
        ajv.addSchema(schema);
    return ajv;
}
async function loadReferencedSchema(uri, from, root) {
    if ((/^[a-z][a-z\d+.-]*:/i.test(uri) && !uri.startsWith('file:')) || uri.includes('\\')) {
        throw new Error(`Remote or absolute schema references are not supported: ${uri}`);
    }
    const hash = uri.indexOf('#');
    const document = hash === -1 ? uri : uri.slice(0, hash);
    if (!document)
        throw new Error(`Schema reference has no document: ${uri}`);
    const catalogRoot = await realpath(resolve(root));
    let candidate;
    if (document.startsWith('file:')) {
        candidate = fileURLToPath(document);
    }
    else {
        let decoded;
        try {
            decoded = decodeURIComponent(document);
        }
        catch {
            throw new Error(`Schema reference contains invalid percent encoding: ${uri}`);
        }
        if (isAbsolute(decoded) ||
            decoded.includes('\\') ||
            [...decoded].some((character) => isControl(character.codePointAt(0)))) {
            throw new Error(`Schema reference must use a relative POSIX path: ${uri}`);
        }
        candidate = resolve(dirname(from), ...decoded.split('/'));
    }
    const target = await realpath(candidate);
    if (!within(catalogRoot, target))
        throw new Error(`Schema reference escapes the catalog root: ${uri}`);
    const source = portable(relative(catalogRoot, target));
    const parsed = await readReferencedSchema(target, source, uri);
    const diagnostics = [];
    validateSchemaDocument(parsed, source, diagnostics);
    if (diagnostics.length)
        throw new Error(diagnostics[0]?.message);
    return parsed;
}
async function readReferencedSchema(target, source, uri) {
    if (extname(target) === '.json') {
        const text = await readBounded(target);
        const syntax = parseDocument(text, { prettyErrors: false, strict: true, uniqueKeys: true });
        if (syntax.errors.length)
            throw new Error(syntax.errors[0]?.message);
        const parsed = JSON.parse(text);
        const limit = valueLimit(parsed);
        if (limit)
            throw new Error(`Referenced schema exceeds the ${limit} limit.`);
        return parsed;
    }
    if (!['.yml', '.yaml'].includes(extname(target))) {
        throw new Error(`Referenced schemas must use .json, .yml, or .yaml: ${uri}`);
    }
    const yaml = await loadYaml(target, source);
    if (yaml.diagnostics.length)
        throw new Error(yaml.diagnostics[0]?.message);
    return yaml.data;
}
function withFileBase(schema, file) {
    if (Object.hasOwn(schema, '$id'))
        return schema;
    return { $id: pathToFileURL(file).href, ...schema };
}
function hasLocalSchemaReference(value) {
    if (Array.isArray(value))
        return value.some(hasLocalSchemaReference);
    if (!value || typeof value !== 'object')
        return false;
    for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' &&
            typeof child === 'string' &&
            child !== '' &&
            !child.startsWith('#') &&
            !isAbsolute(child) &&
            !/^[a-z][a-z\d+.-]*:/i.test(child) &&
            !child.includes('\\'))
            return true;
        if (hasLocalSchemaReference(child))
            return true;
    }
    return false;
}
function within(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function isControl(code) {
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}
//# sourceMappingURL=load.js.map
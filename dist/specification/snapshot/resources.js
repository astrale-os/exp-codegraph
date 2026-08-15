import { sep } from 'node:path';
import { readBounded, sourceRevision } from '../../source/file.js';
import { loadSchema } from '../../schema/load.js';
import { loadSpecificationDeclarationResource } from '../declaration.js';
import { resolvePort } from '../port.js';
import { compileCode } from '../module/code.js';
import { compileDescriptor } from '../module/descriptor.js';
import { compileLayout } from '../module/layout.js';
import { compilePackageDefinition, compilePackagePatterns, packageNameFromPath, } from '../module/package.js';
export async function loadCodeDeclaration(file) {
    try {
        const text = await readBounded(file.absolute);
        const compiled = compileCode(file.source, text);
        return {
            ...(compiled.configuration
                ? {
                    resource: {
                        ref: './code.ts',
                        source: file.source,
                        text,
                        revision: sourceRevision(text),
                        internals: compiled.configuration.internals,
                    },
                }
                : {}),
            diagnostics: [...compiled.diagnostics],
        };
    }
    catch (error) {
        return { diagnostics: [fileDiagnostic('CODE_DECLARATION_INVALID', error, file)] };
    }
}
export function normativeResourceRevision(resource) {
    if (!('model' in resource) || !resource.model)
        return resource.revision;
    return sourceRevision(`${resource.revision}\0${resource.model.sourceRevision}\0${resource.model.fingerprint}`);
}
export async function loadSchemas(root, files) {
    return compact(await Promise.all(files.map(async (file) => {
        try {
            const schema = await loadSchema(file.absolute, file.source, root, [], { compile: false });
            return {
                resource: {
                    ref: `./${file.relative}`,
                    source: file.source,
                    text: schema.text,
                    revision: sourceRevision(schema.text),
                    schema: schema.schema,
                },
                diagnostics: schema.diagnostics,
            };
        }
        catch (error) {
            return { diagnostics: [fileDiagnostic('SCHEMA_RESOURCE_INVALID', error, file)] };
        }
    })));
}
export async function loadPorts(root, apiFile, specSource, files) {
    return compact(await Promise.all(files.map(async (file) => {
        const pointer = `/${file.relative}`;
        const declaration = await loadSpecificationDeclarationResource(root, apiFile, specSource, `./${file.relative}`, pointer);
        const diagnostics = [...declaration.diagnostics];
        if (!declaration.resource)
            return { diagnostics };
        const resolved = resolvePort(declaration.resource, pointer, portNamespace(file.relative));
        diagnostics.push(...resolved.diagnostics);
        return { ...(resolved.port ? { resource: resolved.port } : {}), diagnostics };
    })));
}
export async function loadDescriptors(kind, files) {
    return compact(await Promise.all(files.map(async (file) => {
        try {
            const text = await readBounded(file.absolute);
            const compiled = compileDescriptor(kind, file.source, text);
            return {
                resource: {
                    ref: `./${file.relative}`,
                    source: file.source,
                    text,
                    revision: sourceRevision(text),
                    kind,
                    definitions: compiled.definitions,
                },
                diagnostics: [...compiled.diagnostics],
            };
        }
        catch (error) {
            return { diagnostics: [fileDiagnostic('MODULE_DESCRIPTOR_INVALID', error, file)] };
        }
    })));
}
export async function loadCodeResources(kind, files) {
    return compact(await Promise.all(files.map((file) => loadCodeResource(kind, file))));
}
export async function loadCodeResource(kind, file) {
    try {
        const text = await readBounded(file.absolute);
        return {
            resource: {
                ref: `./${file.relative}`,
                source: file.source,
                text,
                revision: sourceRevision(text),
                kind,
            },
            diagnostics: [],
        };
    }
    catch (error) {
        return { diagnostics: [fileDiagnostic('MODULE_SOURCE_INVALID', error, file)] };
    }
}
export async function loadAuthoredLayout(file) {
    try {
        const text = await readBounded(file.absolute);
        const compiled = compileLayout(file.source, text);
        return {
            resource: {
                ref: './layout.ts',
                source: file.source,
                text,
                revision: sourceRevision(text),
                entries: compiled.entries.map(({ path, kind }) => ({ path, kind })),
                exact: compiled.exact,
                ignore: compiled.ignore,
            },
            diagnostics: compiled.diagnostics,
        };
    }
    catch (error) {
        return { diagnostics: [fileDiagnostic('LAYOUT_INVALID', error, file)] };
    }
}
export async function loadExamples(files) {
    return compact(await Promise.all(files.map(async (file) => {
        try {
            const text = await readBounded(file.absolute);
            return {
                resource: {
                    ref: `./${file.relative}`,
                    source: file.source,
                    text,
                    revision: sourceRevision(text),
                    against: 'api',
                    declarationPointer: `/${file.relative}`,
                },
                diagnostics: [],
            };
        }
        catch (error) {
            return { diagnostics: [fileDiagnostic('EXAMPLE_INVALID', error, file)] };
        }
    })));
}
export async function loadPackages(files) {
    return compact(await Promise.all(files.map(async (file) => {
        try {
            const text = await readBounded(file.absolute);
            const compiled = compilePackageDefinition(file.source, text);
            const diagnostics = [...compiled.diagnostics];
            const pathName = packageNameFromPath(file.relative);
            if (!pathName) {
                diagnostics.push({
                    code: 'PACKAGE_PATH_INVALID',
                    message: 'Package file paths must encode a valid package name.',
                    file: file.source,
                    line: 1,
                    column: 1,
                });
            }
            else if (compiled.definition && pathName !== compiled.definition.package) {
                diagnostics.push({
                    code: 'PACKAGE_PATH_MISMATCH',
                    message: `Package file path declares ${pathName}, but its definition declares ${compiled.definition.package}.`,
                    file: file.source,
                    line: 1,
                    column: 1,
                });
            }
            return {
                ...(compiled.definition
                    ? {
                        resource: {
                            ref: `./${file.relative}`,
                            source: file.source,
                            text,
                            revision: sourceRevision(text),
                            ...compiled.definition,
                        },
                    }
                    : {}),
                diagnostics,
            };
        }
        catch (error) {
            return { diagnostics: [fileDiagnostic('PACKAGE_DEFINITION_INVALID', error, file)] };
        }
    })));
}
export async function loadPackagePatterns(file) {
    try {
        const text = await readBounded(file.absolute);
        const compiled = compilePackagePatterns(file.source, text);
        return {
            resources: compiled.definitions.map((definition, index) => ({
                ref: `./${file.relative}#${index}`,
                source: file.source,
                text,
                revision: sourceRevision(text),
                ...definition,
            })),
            diagnostics: compiled.diagnostics,
        };
    }
    catch (error) {
        return { resources: [], diagnostics: [fileDiagnostic('PACKAGE_PATTERNS_INVALID', error, file)] };
    }
}
export function revisionOf(resources) {
    return sourceRevision(resources
        .map(([source, revision]) => `${source}\0${revision}`)
        .sort(compare)
        .join('\0'));
}
export function deduplicateDiagnostics(values) {
    const seen = new Set();
    return values.filter((value) => {
        const key = JSON.stringify([
            value.code,
            value.message,
            value.file,
            value.line,
            value.column,
            value.pointer,
        ]);
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function fileDiagnostic(code, error, file) {
    return {
        code,
        message: error instanceof Error ? error.message : String(error),
        file: file.source,
        line: 1,
        column: 1,
    };
}
export function moduleTitle(source, fallback) {
    if (source === '.')
        return fallback || 'module';
    return source.split('/').filter(Boolean).join('.');
}
export function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
function compact(loaded) {
    return {
        resources: loaded.flatMap((entry) => (entry.resource ? [entry.resource] : [])),
        diagnostics: loaded.flatMap((entry) => entry.diagnostics),
    };
}
function portNamespace(relativePath) {
    const segments = relativePath.split('/').slice(1, -1);
    return segments.length ? segments.join('.') : undefined;
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=resources.js.map
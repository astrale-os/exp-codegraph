import { specificationApiCompiler } from '../compiler/default.js';
import { readBounded, sourceRevision } from '../source/file.js';
import { locateResource } from '../source/resource.js';
export function createDeclarationResourceLoader(compiler, semantics, version) {
    return async function loadDeclarationResource(root, containingFile, ownerSource, reference, pointer) {
        const diagnostics = [];
        try {
            const located = await locateResource(root, containingFile, reference, '.d.ts');
            const compilationRequest = compiler.compile({
                mainFile: located.absolute,
                projectRoot: root,
                semantics,
            });
            const [text, compilation] = await Promise.all([
                readBounded(located.absolute),
                compilationRequest,
            ]);
            const revision = sourceRevision(text);
            diagnostics.push(...compilation.diagnostics
                .filter((diagnostic) => diagnostic.severity === 'error')
                .map((diagnostic) => declarationDiagnostic(ownerSource, located.source, pointer, diagnostic)));
            if (compilation.ok && compilation.api && compilation.api.version !== version) {
                diagnostics.push({
                    code: 'DECLARATION_COMPILER_SEMANTICS_MISMATCH',
                    message: `Declaration compiler returned API model V${compilation.api.version}; V${version} was required.`,
                    file: located.source,
                    line: 1,
                    column: 1,
                    pointer,
                });
            }
            const model = compilation.ok && compilation.api?.version === version
                ? compilation.api
                : undefined;
            return {
                resource: {
                    ref: reference,
                    source: located.source,
                    text,
                    revision,
                    ...(model ? { model } : {}),
                },
                diagnostics,
            };
        }
        catch (error) {
            return {
                diagnostics: [
                    {
                        code: 'DECLARATION_RESOURCE_INVALID',
                        message: error instanceof Error ? error.message : String(error),
                        file: ownerSource,
                        line: 1,
                        column: 1,
                        pointer,
                    },
                ],
            };
        }
    };
}
export const loadDeclarationResource = createDeclarationResourceLoader(specificationApiCompiler, 'specification-v2', 2);
/** V2 authored declaration compiler used only by immutable specification snapshots. */
export const loadSpecificationDeclarationResource = loadDeclarationResource;
function declarationDiagnostic(ownerSource, resourceSource, pointer, diagnostic) {
    return {
        code: stableCode(diagnostic),
        message: diagnostic.message,
        file: diagnostic.range?.file ?? resourceSource ?? ownerSource,
        line: diagnostic.range?.start.line ?? 1,
        column: diagnostic.range?.start.column ?? 1,
        pointer,
    };
}
function stableCode(diagnostic) {
    const source = diagnostic.source.replaceAll(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    const code = diagnostic.code.replaceAll(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    return `API_${source}_${code}`;
}
//# sourceMappingURL=declaration.js.map
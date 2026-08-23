import { specificationApiCompiler } from '../compiler/default.js';
import { sourceRevision } from '../source/file.js';
import { operationSnapshot, operationSnapshotNamespace, readOperationSourceText, readSourceRevision, } from '../source/operation-snapshot.js';
import { locateResource } from '../source/resource.js';
const restoredDeclarations = operationSnapshotNamespace('restored-specification-declarations');
const declarationNavigation = operationSnapshotNamespace('specification-declaration-navigation');
const declarationModels = operationSnapshotNamespace('specification-declaration-models');
/** Select presentation-only declaration navigation for one coherent specification operation. */
export function configureSpecificationDeclarationNavigation(include) {
    operationSnapshot(declarationNavigation)?.set('include', include);
}
/** Select complete normalized declaration models for one coherent specification operation. */
export function configureSpecificationDeclarationModels(include) {
    operationSnapshot(declarationModels)?.set('include', include);
}
export function createDeclarationResourceLoader(compiler, semantics, version) {
    return async function loadDeclarationResource(root, containingFile, ownerSource, reference, pointer) {
        const diagnostics = [];
        try {
            const located = await locateResource(root, containingFile, reference, '.d.ts');
            const restored = operationSnapshot(restoredDeclarations)?.get(declarationKey(located.source, pointer, version));
            if (restored && (await readSourceRevision(located.absolute)) === restored.resource?.revision) {
                return restored;
            }
            const compilationRequest = compiler.compile({
                mainFile: located.absolute,
                projectRoot: root,
                semantics,
                declarationNavigation: specificationDeclarationNavigation(),
                declarationModel: specificationDeclarationModels(),
            });
            const [text, compilation] = await Promise.all([
                readOperationSourceText(located.absolute),
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
/** Restore declaration results only when the exact inventory delta cannot affect declaration input. */
export function seedSpecificationDeclarationResources(specifications, changed) {
    const cache = operationSnapshot(restoredDeclarations);
    const seeded = new Set();
    if (!cache || changed.some((path) => path.endsWith('.d.ts') || path.endsWith('.json')))
        return seeded;
    for (const specification of specifications) {
        const resources = [
            ['/api', specification.module.api],
            ['/internal', specification.module.internal],
            ...specification.module.ports.map((resource) => [resource.declarationPointer, resource]),
        ];
        for (const [pointer, resource] of resources) {
            if (!resource)
                continue;
            cache.set(declarationKey(resource.source, pointer, 2), {
                resource,
                diagnostics: specification.diagnostics.filter((diagnostic) => diagnostic.pointer === pointer &&
                    (diagnostic.code.startsWith('API_') || diagnostic.code === 'DECLARATION_RESOURCE_INVALID')),
            });
            seeded.add(resource.source);
        }
    }
    return seeded;
}
function declarationKey(file, pointer, version) {
    return `${file}\0${pointer}\0${version}`;
}
function specificationDeclarationNavigation() {
    return operationSnapshot(declarationNavigation)?.get('include') ?? true;
}
function specificationDeclarationModels() {
    return operationSnapshot(declarationModels)?.get('include') ?? true;
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
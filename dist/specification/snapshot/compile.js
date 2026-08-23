import { basename, dirname, relative } from 'node:path';
import { loadSpecificationDeclarationResource } from '../declaration.js';
import { specificationModuleId, specificationSnapshotIdentity } from './identity.js';
import { duplicatePortNameDiagnostics } from '../port.js';
import { inventoryModuleFiles } from '../module/inventory.js';
import { deduplicateDiagnostics, loadAuthoredLayout, loadCodeDeclaration, loadCodeResource, loadCodeResources, loadDescriptors, loadExamples, loadPackagePatterns, loadPackages, loadPorts, loadSchemas, moduleTitle, normativeResourceRevision, portable, revisionOf, } from './resources.js';
import { validateModuleSemantics } from '../module/semantics.js';
import { analyzeModuleTypeScript } from '../module/typescript.js';
import { loadSpecificationPackageAuthority } from './package-authority.js';
/** Compile only authored normative meaning; observation and qualification are separate consumers. */
export async function compileSpecificationSnapshot(root, specDirectory) {
    const inventory = await inventoryModuleFiles(root, specDirectory);
    const apiFile = inventory.api.absolute;
    const source = inventory.api.source;
    const moduleRoot = dirname(specDirectory);
    const moduleRootSource = portable(relative(root, moduleRoot)) || '.';
    const diagnostics = [...inventory.diagnostics];
    const [api, code, internal, schemas, ports, capabilities, flows, laws, states, limits, layout, examples, benchmarks, packages, packagePatterns,] = await Promise.all([
        loadSpecificationDeclarationResource(root, apiFile, source, './api.d.ts', '/api'),
        inventory.code ? loadCodeDeclaration(inventory.code) : undefined,
        inventory.internal
            ? loadSpecificationDeclarationResource(root, apiFile, source, './internal.d.ts', '/internal')
            : undefined,
        loadSchemas(root, inventory.schemas),
        loadPorts(root, apiFile, source, inventory.ports),
        loadDescriptors('capability', inventory.capabilities),
        loadCodeResources('flow', inventory.flows),
        loadDescriptors('law', inventory.laws),
        loadDescriptors('state', inventory.states),
        inventory.limits ? loadCodeResource('limits', inventory.limits) : undefined,
        inventory.layout ? loadAuthoredLayout(inventory.layout) : undefined,
        loadExamples(inventory.examples),
        loadDescriptors('benchmark', inventory.benchmarks),
        loadPackages(inventory.packages),
        inventory.packageExceptions
            ? loadPackagePatterns(inventory.packageExceptions)
            : Promise.resolve({ resources: [], diagnostics: [] }),
    ]);
    const typeScript = await analyzeModuleTypeScript(root, inventory);
    const packageAuthority = await loadSpecificationPackageAuthority(root, moduleRoot, inventory);
    diagnostics.push(...api.diagnostics, ...(internal?.diagnostics ?? []), ...schemas.diagnostics, ...ports.diagnostics, ...capabilities.diagnostics, ...flows.diagnostics, ...laws.diagnostics, ...states.diagnostics, ...(limits?.diagnostics ?? []), ...(layout?.diagnostics ?? []), ...examples.diagnostics, ...benchmarks.diagnostics, ...packages.diagnostics, ...packagePatterns.diagnostics, ...packageAuthority.diagnostics, ...(code?.diagnostics ?? []), ...typeScript.diagnostics, ...duplicatePortNameDiagnostics(ports.resources, source), ...validateModuleSemantics({
        capabilities: capabilities.resources,
        laws: laws.resources,
        benchmarks: benchmarks.resources,
        schemas: schemas.resources,
        packages: packages.resources,
        packagePatterns: packagePatterns.resources,
    }));
    const authoredLaws = laws.resources.map((resource) => ({
        ...resource,
        definitions: resource.definitions.map(({ testEvidence: _evidence, ...definition }) => definition),
    }));
    const authoredStates = states.resources.map((resource) => ({
        ...resource,
        definitions: resource.definitions.map(({ testEvidence: _evidence, ...definition }) => definition),
    }));
    const normativeResources = [
        ...(api.resource ? [api.resource] : []),
        ...(code?.resource ? [code.resource] : []),
        ...(internal?.resource ? [internal.resource] : []),
        ...ports.resources,
        ...schemas.resources,
        ...capabilities.resources,
        ...flows.resources,
        ...authoredLaws,
        ...authoredStates,
        ...(limits?.resource ? [limits.resource] : []),
        ...(layout?.resource ? [layout.resource] : []),
        ...examples.resources,
        ...benchmarks.resources,
        ...packages.resources,
        ...packagePatterns.resources,
        ...packageAuthority.authority.packages,
        ...packageAuthority.authority.packagePatterns,
    ];
    const revision = revisionOf(normativeResources.map((resource) => [resource.source, normativeResourceRevision(resource)]));
    const title = moduleTitle(moduleRootSource, basename(moduleRoot));
    const compiled = {
        format: 'astrale.typespec.specification',
        version: 2,
        revision,
        source,
        title,
        root: moduleRootSource,
        module: {
            id: specificationModuleId(source, ''),
            name: title,
            declarationPointer: '',
            ...(api.resource ? { api: api.resource } : {}),
            ...(code?.resource ? { code: code.resource } : {}),
            ...(internal?.resource ? { internal: internal.resource } : {}),
            ports: ports.resources,
            packageAuthority: packageAuthority.authority,
            packages: packageAuthority.authority.packages.map((resource) => resource.package),
        },
        schemas: schemas.resources,
        examples: examples.resources,
        capabilities: capabilities.resources,
        flows: flows.resources,
        laws: authoredLaws,
        states: authoredStates,
        ...(limits?.resource ? { limits: limits.resource } : {}),
        ...(layout?.resource ? { layout: layout.resource } : {}),
        benchmarks: benchmarks.resources,
        packages: packages.resources,
        packagePatterns: packagePatterns.resources,
        sourceReferences: typeScript.references,
        diagnostics: deduplicateDiagnostics(diagnostics),
    };
    const id = specificationSnapshotIdentity(compiled);
    return immutable({ ...compiled, id });
}
function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    for (const entry of Object.values(value))
        immutable(entry);
    return Object.freeze(value);
}
//# sourceMappingURL=compile.js.map
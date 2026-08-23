import { basename, dirname, relative } from 'node:path'

import type { Diagnostic } from '../../source/diagnostic.ts'
import { loadSpecificationDeclarationResource } from '../declaration.ts'
import { specificationModuleId, specificationSnapshotIdentity } from './identity.ts'
import { duplicatePortNameDiagnostics } from '../port.ts'
import { inventoryModuleFiles } from '../module/inventory.ts'
import {
  deduplicateDiagnostics,
  loadAuthoredLayout,
  loadCodeDeclaration,
  loadCodeResource,
  loadCodeResources,
  loadDescriptors,
  loadExamples,
  loadPackagePatterns,
  loadPackages,
  loadPorts,
  loadSchemas,
  moduleTitle,
  normativeResourceRevision,
  portable,
  revisionOf,
} from './resources.ts'
import { validateModuleSemantics } from '../module/semantics.ts'
import { analyzeModuleTypeScript } from '../module/typescript.ts'
import type {
  AuthoredLawResource,
  AuthoredStateResource,
  SpecificationSnapshot,
} from './model.ts'
import { loadSpecificationPackageAuthority } from './package-authority.ts'

/** Compile only authored normative meaning; observation and qualification are separate consumers. */
export async function compileSpecificationSnapshot(
  root: string,
  specDirectory: string,
): Promise<SpecificationSnapshot> {
  const inventory = await inventoryModuleFiles(root, specDirectory)
  const apiFile = inventory.api.absolute
  const source = inventory.api.source
  const moduleRoot = dirname(specDirectory)
  const moduleRootSource = portable(relative(root, moduleRoot)) || '.'
  const diagnostics: Diagnostic[] = [...inventory.diagnostics]
  const [
    api,
    code,
    internal,
    schemas,
    ports,
    capabilities,
    flows,
    laws,
    states,
    limits,
    layout,
    examples,
    benchmarks,
    packages,
    packagePatterns,
  ] = await Promise.all([
    loadSpecificationDeclarationResource(root, apiFile, source, './api.d.ts', '/api'),
    inventory.code ? loadCodeDeclaration(inventory.code) : undefined,
    inventory.internal
      ? loadSpecificationDeclarationResource(
          root,
          apiFile,
          source,
          './internal.d.ts',
          '/internal',
        )
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
  ])
  const typeScript = await analyzeModuleTypeScript(root, inventory)
  const packageAuthority = await loadSpecificationPackageAuthority(
    root,
    moduleRoot,
    inventory,
  )
  diagnostics.push(
    ...api.diagnostics,
    ...(internal?.diagnostics ?? []),
    ...schemas.diagnostics,
    ...ports.diagnostics,
    ...capabilities.diagnostics,
    ...flows.diagnostics,
    ...laws.diagnostics,
    ...states.diagnostics,
    ...(limits?.diagnostics ?? []),
    ...(layout?.diagnostics ?? []),
    ...examples.diagnostics,
    ...benchmarks.diagnostics,
    ...packages.diagnostics,
    ...packagePatterns.diagnostics,
    ...packageAuthority.diagnostics,
    ...(code?.diagnostics ?? []),
    ...typeScript.diagnostics,
    ...duplicatePortNameDiagnostics(ports.resources, source),
    ...validateModuleSemantics({
      capabilities: capabilities.resources,
      laws: laws.resources,
      benchmarks: benchmarks.resources,
      schemas: schemas.resources,
      packages: packages.resources,
      packagePatterns: packagePatterns.resources,
    }),
  )

  const authoredLaws: AuthoredLawResource[] = laws.resources.map((resource) => ({
    ...resource,
    definitions: resource.definitions.map(({ testEvidence: _evidence, ...definition }) =>
      definition,
    ),
  }))
  const authoredStates: AuthoredStateResource[] = states.resources.map((resource) => ({
    ...resource,
    definitions: resource.definitions.map(({ testEvidence: _evidence, ...definition }) =>
      definition,
    ),
  }))
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
  ]
  const revision = revisionOf(
    normativeResources.map(
      (resource) => [resource.source, normativeResourceRevision(resource)] as const,
    ),
  )
  const title = moduleTitle(moduleRootSource, basename(moduleRoot))
  const compiled = {
    format: 'astrale.typespec.specification' as const,
    version: 2 as const,
    revision,
    source,
    title,
    root: moduleRootSource,
    module: {
      id: specificationModuleId(source, ''),
      name: title,
      declarationPointer: '' as const,
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
  }
  const id = specificationSnapshotIdentity(compiled)
  return immutable({ ...compiled, id })
}

function immutable<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry)
  return Object.freeze(value)
}

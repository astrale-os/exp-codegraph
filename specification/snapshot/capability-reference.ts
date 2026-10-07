import { join } from 'node:path'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type { CapabilityResource, LawResource } from '../resource/index.ts'

import { optionalDirectFile } from '../../source/file.ts'
import { isDescendantModulePath } from '../capability.ts'
import { locateDescriptorValue } from '../module/descriptor.ts'
import { inventoryModuleFiles } from '../module/inventory.ts'
import { loadDescriptors } from './resources.ts'

export interface ModuleSemanticDeclarations {
  /** Catalog-relative POSIX module root; `.` names the catalog root. */
  readonly root: string
  readonly source: string
  readonly capabilities: readonly CapabilityResource[]
  readonly laws: readonly LawResource[]
}

/**
 * Load the capability and law descriptors of one specified module without compiling its contract.
 *
 * A directory without a direct `.spec/api.d.ts`, or one resolving outside the catalog, is not a
 * specified module.
 */
export async function loadModuleSemanticDeclarations(
  catalogRoot: string,
  specDirectory: string,
): Promise<ModuleSemanticDeclarations | undefined> {
  let inventory
  try {
    if (!(await optionalDirectFile(join(specDirectory, 'api.d.ts')))) return
    inventory = await inventoryModuleFiles(catalogRoot, specDirectory)
  } catch {
    return
  }
  const [capabilities, laws] = await Promise.all([
    loadDescriptors('capability', inventory.capabilities),
    loadDescriptors('law', inventory.laws),
  ])
  const source = inventory.api.source
  return {
    root: source === '.spec/api.d.ts' ? '.' : source.slice(0, -'/.spec/api.d.ts'.length),
    source,
    capabilities: capabilities.resources,
    laws: laws.resources,
  }
}

/**
 * Resolve every `{ module, id }` citation against the descriptors its descendant module declares.
 *
 * Resolution is syntactic: descendant descriptors are parsed, never imported or executed.
 */
export async function resolveCapabilityReferences(
  catalogRoot: string,
  moduleRoot: string,
  capabilities: readonly CapabilityResource[],
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const modules = new Map<string, Promise<ModuleSemanticDeclarations | undefined>>()
  for (const resource of capabilities) {
    for (const definition of resource.definitions) {
      for (const field of ['laws', 'capabilities'] as const) {
        for (const reference of definition[field] ?? []) {
          if (typeof reference === 'string' || !isDescendantModulePath(reference.module)) continue
          const directory = join(moduleRoot, ...reference.module.split('/'), '.spec')
          let pending = modules.get(directory)
          if (!pending) {
            pending = loadModuleSemanticDeclarations(catalogRoot, directory)
            modules.set(directory, pending)
          }
          const declarations = await pending
          const located = (property: 'module' | 'id') => ({
            file: resource.source,
            ...locateDescriptorValue(resource.source, resource.text, definition.exportName, [
              field,
              { element: reference },
              property,
            ]),
          })
          if (!declarations) {
            diagnostics.push({
              code: 'CAPABILITY_MODULE_UNKNOWN',
              message: `Capability ${definition.id} references ${reference.module}, which is not a specified descendant module (no .spec/api.d.ts).`,
              ...located('module'),
            })
            continue
          }
          const declared = field === 'laws' ? declarations.laws : declarations.capabilities
          if (
            declared.some((target) =>
              target.definitions.some((candidate) => candidate.id === reference.id),
            )
          ) {
            continue
          }
          diagnostics.push({
            code: field === 'laws' ? 'CAPABILITY_LAW_UNKNOWN' : 'CAPABILITY_CAPABILITY_UNKNOWN',
            message: `Capability ${definition.id} references undeclared ${field === 'laws' ? 'law' : 'capability'} ${reference.id} in module ${reference.module}.`,
            ...located('id'),
          })
        }
      }
    }
  }
  return diagnostics
}

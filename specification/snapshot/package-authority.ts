import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type {
  SpecificationPackageAuthority,
} from './model.ts'
import type { ModuleFileInventory } from '../module/inventory.ts'

import { optionalDirectFile } from '../../source/file.ts'
import { inventoryModuleFiles } from '../module/inventory.ts'
import { loadPackagePatterns, loadPackages } from './resources.ts'

export interface LoadedPackageAuthority {
  readonly authority: SpecificationPackageAuthority
  readonly diagnostics: readonly Diagnostic[]
}

/** Resolve the one package-root specification that governs every nested semantic module. */
export async function loadSpecificationPackageAuthority(
  catalogRoot: string,
  moduleRoot: string,
  localInventory: ModuleFileInventory,
): Promise<LoadedPackageAuthority> {
  const packageRoot = await nearestPackageRoot(catalogRoot, moduleRoot)
  const authoritySpec = packageRoot ? join(packageRoot, '.spec') : undefined
  const authorityInventory =
    authoritySpec && (await optionalDirectFile(join(authoritySpec, 'api.d.ts')))
      ? resolve(authoritySpec) === resolve(dirname(localInventory.api.absolute))
        ? localInventory
        : await inventoryModuleFiles(catalogRoot, authoritySpec)
      : localInventory
  const [packages, packagePatterns] = await Promise.all([
    loadPackages(authorityInventory.packages),
    authorityInventory.packageExceptions
      ? loadPackagePatterns(authorityInventory.packageExceptions)
      : Promise.resolve({ resources: [], diagnostics: [] }),
  ])
  return {
    authority: {
      source: authorityInventory.api.source,
      packages: packages.resources,
      packagePatterns: packagePatterns.resources,
    },
    diagnostics: [...packages.diagnostics, ...packagePatterns.diagnostics],
  }
}

async function nearestPackageRoot(
  catalogRoot: string,
  moduleRoot: string,
): Promise<string | undefined> {
  const root = resolve(catalogRoot)
  let current = resolve(moduleRoot)
  while (within(root, current)) {
    if (await optionalDirectFile(join(current, 'package.json'))) return current
    if (current === root) return
    current = dirname(current)
  }
  return
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

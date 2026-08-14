import type { ObservedDeclaration } from '../analysis/typescript/surface/model.ts'
import type { ApiModelV2 } from './model.ts'

export interface ApiCatalogModule {
  readonly id: string
  readonly name: string
  readonly declarationPointer: string
  readonly api?: { readonly model?: ApiModelV2 }
}

export interface ApiCatalogSpecification {
  readonly source: string
  readonly modules: readonly ApiCatalogModule[]
}

export interface ApiCatalog {
  readonly specs: readonly ApiCatalogSpecification[]
}

export interface ApiDeclarationOwner {
  readonly spec: ApiCatalogSpecification
  readonly module: ApiCatalogModule
  readonly declaration: ObservedDeclaration
}

export interface ApiCatalogIndex {
  readonly owner: ReadonlyMap<string, ApiDeclarationOwner>
  readonly declaration: ReadonlyMap<string, ObservedDeclaration>
  readonly exportsByModule: ReadonlyMap<string, ReadonlySet<string>>
}

/** Resolve every observed API declaration to the most specific owning module in a catalog. */
export function indexCatalogApis(catalog: ApiCatalog): ApiCatalogIndex {
  const owner = new Map<string, ApiDeclarationOwner>()
  const declaration = new Map<string, ObservedDeclaration>()
  const exportsByModule = new Map<string, ReadonlySet<string>>()
  const apiModules = catalog.specs.flatMap((spec) =>
    spec.modules.flatMap((module) => (module.api?.model ? [{ spec, module }] : [])),
  )
  for (const { module } of apiModules) {
    if (!module.api?.model) continue
    exportsByModule.set(
      module.id,
      new Set(module.api.model.surface.exports.map((item) => item.declaration)),
    )
    for (const item of module.api.model.surface.declarations) declaration.set(item.identity, item)
  }
  for (const item of declaration.values()) {
    if (!item.location.file) continue
    const owningModule = apiModules
      .filter(({ module }) =>
        insideApiDirectory(module.api!.model!.entrypoint, item.location.file!),
      )
      .sort((left, right) => compareApiOwners(left, right, item))[0]
    if (owningModule) owner.set(item.identity, { ...owningModule, declaration: item })
  }
  return { owner, declaration, exportsByModule }
}

function compareApiOwners(
  left: { readonly module: ApiCatalogModule },
  right: { readonly module: ApiCatalogModule },
  declaration: ObservedDeclaration,
): number {
  const file = declaration.location.file!
  const exactEntrypoint =
    Number(right.module.api!.model!.entrypoint === file) -
    Number(left.module.api!.model!.entrypoint === file)
  if (exactEntrypoint) return exactEntrypoint

  const exportDepth =
    directExportDepth(left, declaration.identity) - directExportDepth(right, declaration.identity)
  if (exportDepth) return exportDepth

  const directoryDepth =
    apiDirectory(right.module.api!.model!.entrypoint).length -
    apiDirectory(left.module.api!.model!.entrypoint).length
  if (directoryDepth) return directoryDepth
  return left.module.id < right.module.id ? -1 : left.module.id > right.module.id ? 1 : 0
}

function directExportDepth(owner: { readonly module: ApiCatalogModule }, identity: string): number {
  const depths = owner.module
    .api!.model!.surface.exports.filter((item) => item.declaration === identity)
    .map((item) => item.path.length)
  return depths.length ? Math.min(...depths) : Number.POSITIVE_INFINITY
}

function insideApiDirectory(entrypoint: string, file: string): boolean {
  const directory = apiDirectory(entrypoint)
  return directory === '.'
    ? !file.includes('/')
    : file === directory || file.startsWith(`${directory}/`)
}

function apiDirectory(entrypoint: string): string {
  const index = entrypoint.lastIndexOf('/')
  return index < 0 ? '.' : entrypoint.slice(0, index)
}

import { dirname, extname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

import type { RepositoryInventory, RepositorySourceService } from '../../repository/index.ts'
import { visitModuleReferences } from '../../specification/module/typescript-reference.ts'
import type {
  ApplicationDependencyOptimizationPlan,
  ApplicationSpecificationAnchor,
} from './model.ts'

export type { ApplicationDependencyOptimizationPlan } from './model.ts'

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  types: [],
  ignoreDeprecations: '6.0',
}

/**
 * Conservatively preplan authored specification imports before normative compilation.
 * Checker-derived snapshot references remain authoritative and repair every missed edge.
 */
export async function planApplicationDependencyOptimization(
  root: string,
  anchors: readonly ApplicationSpecificationAnchor[],
  primary: readonly ApplicationSpecificationAnchor[],
  inventory: RepositoryInventory,
  sources: RepositorySourceService,
  signal?: AbortSignal,
): Promise<ApplicationDependencyOptimizationPlan> {
  try {
    const owners = specificationOwnerIndex(anchors)
    const sourcesByOwner = specificationSourcesByOwner(inventory, owners)
    const dependencies = new Map<string, Set<string>>()
    let inspectedSources = 0
    let unavailableSources = 0
    const bySource = new Map(anchors.map((anchor) => [anchor.source, anchor] as const))
    const closure = new Set(primary.map((anchor) => anchor.source))
    const pending = [...primary]
    while (pending.length) {
      signal?.throwIfAborted()
      const owner = pending.pop()!
      const admit = (target: ApplicationSpecificationAnchor | undefined) => {
        if (!target || target.source === owner.source) return
        dependencySet(dependencies, owner.source).add(target.source)
        if (closure.has(target.source)) return
        closure.add(target.source)
        pending.push(target)
      }
      for (const file of sourcesByOwner.get(owner.source) ?? []) {
        const read = await sources.read({
          source: file.source,
          revision: file.revision,
          ...(signal ? { signal } : {}),
        })
        if (read.status !== 'current') {
          unavailableSources += 1
          continue
        }
        inspectedSources += 1
        const sourceFile = resolve(root, read.path)
        const parsed = ts.createSourceFile(
          sourceFile,
          read.text,
          ts.ScriptTarget.ES2022,
          false,
          ts.ScriptKind.TS,
        )
        visitModuleReferences(parsed, (specifier) => {
          admit(importedOwner(root, sourceFile, specifier, owners))
        })
        for (const reference of parsed.referencedFiles) {
          admit(referencedOwner(root, sourceFile, reference.fileName, owners))
        }
        for (const reference of parsed.typeReferenceDirectives) {
          admit(typeReferenceOwner(root, sourceFile, reference.fileName, owners))
        }
      }
    }
    return {
      outcome: unavailableSources ? 'fallback' : 'planned',
      owners: [...closure].flatMap((source) => {
        const owner = bySource.get(source)
        return owner ? [owner] : []
      }).sort(compareSource),
      inspectedSources,
      dependencyEdges: [...dependencies.values()].reduce((total, values) => total + values.size, 0),
      unavailableSources,
      ...(unavailableSources ? { reason: 'inventory-pinned specification sources were unavailable' } : {}),
    }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      outcome: 'fallback',
      owners: [...primary].sort(compareSource),
      inspectedSources: 0,
      dependencyEdges: 0,
      unavailableSources: 0,
      reason: boundedMessage(error),
    }
  }
}

function specificationSourcesByOwner(
  inventory: RepositoryInventory,
  owners: SpecificationOwnerIndex,
): ReadonlyMap<string, readonly RepositoryInventory['files'][number][]> {
  const values = new Map<string, RepositoryInventory['files'][number][]>()
  for (const file of inventory.files) {
    if (!specificationTypeScript(file.path, file.content)) continue
    const owner = ownerForPath(file.path, owners)
    if (!owner) continue
    const current = values.get(owner.source) ?? []
    current.push(file)
    values.set(owner.source, current)
  }
  return values
}

interface SpecificationOwnerIndex {
  readonly anchors: readonly ApplicationSpecificationAnchor[]
  readonly bySource: ReadonlyMap<string, ApplicationSpecificationAnchor>
}

function specificationOwnerIndex(
  anchors: readonly ApplicationSpecificationAnchor[],
): SpecificationOwnerIndex {
  return {
    anchors: [...anchors].sort(
      (left, right) => dirname(right.source).length - dirname(left.source).length || compareSource(left, right),
    ),
    bySource: new Map(anchors.map((anchor) => [anchor.source, anchor] as const)),
  }
}

function ownerForPath(
  path: string,
  owners: SpecificationOwnerIndex,
): ApplicationSpecificationAnchor | undefined {
  const exact = owners.bySource.get(path)
  if (exact) return exact
  const marker = path.startsWith('.spec/') ? 0 : path.indexOf('/.spec/')
  if (marker >= 0) {
    const directory = marker === 0 ? '.spec' : path.slice(0, marker + '/.spec'.length)
    const owner = owners.bySource.get(`${directory}/api.d.ts`)
    if (owner) return owner
  }
  return owners.anchors.find((anchor) => path.startsWith(`${dirname(anchor.source)}/`))
}

function importedOwner(
  root: string,
  sourceFile: string,
  specifier: string,
  owners: SpecificationOwnerIndex,
): ApplicationSpecificationAnchor | undefined {
  if (relativeSpecifier(specifier)) {
    for (const path of importCandidates(resolve(dirname(sourceFile), specifier))) {
      const owner = ownerForAbsolute(root, path, owners, 'exact-anchor')
      if (owner) return owner
    }
  }
  const resolved = ts.resolveModuleName(specifier, sourceFile, COMPILER_OPTIONS, ts.sys).resolvedModule?.resolvedFileName
  return resolved ? ownerForAbsolute(root, resolved, owners) : undefined
}

function referencedOwner(
  root: string,
  sourceFile: string,
  specifier: string,
  owners: SpecificationOwnerIndex,
): ApplicationSpecificationAnchor | undefined {
  return ownerForAbsolute(root, resolve(dirname(sourceFile), specifier), owners)
}

function typeReferenceOwner(
  root: string,
  sourceFile: string,
  specifier: string,
  owners: SpecificationOwnerIndex,
): ApplicationSpecificationAnchor | undefined {
  const resolved = ts.resolveTypeReferenceDirective(
    specifier,
    sourceFile,
    COMPILER_OPTIONS,
    ts.sys,
  ).resolvedTypeReferenceDirective?.resolvedFileName
  return resolved ? ownerForAbsolute(root, resolved, owners) : undefined
}

function ownerForAbsolute(
  root: string,
  absolute: string,
  owners: SpecificationOwnerIndex,
  mode: 'containing-owner' | 'exact-anchor' = 'containing-owner',
): ApplicationSpecificationAnchor | undefined {
  const path = relative(resolve(root), resolve(absolute))
  if (path === '..' || path.startsWith(`..${sep}`)) return
  const source = portable(path)
  return mode === 'exact-anchor' ? owners.bySource.get(source) : ownerForPath(source, owners)
}

function importCandidates(path: string): readonly string[] {
  const extension = extname(path)
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    const stem = path.slice(0, -extension.length)
    return [`${stem}.d.ts`, `${stem}.ts`, `${stem}.tsx`, path]
  }
  if (extension) return [path]
  return [path, `${path}.d.ts`, `${path}.ts`, `${path}.tsx`, resolve(path, 'index.d.ts'), resolve(path, 'index.ts')]
}

function specificationTypeScript(path: string, content: string): boolean {
  return content === 'text' && path.includes('/.spec/') && /\.(?:[cm]?ts|tsx)$/u.test(path)
}

function relativeSpecifier(value: string): boolean {
  return value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../')
}

function dependencySet(dependencies: Map<string, Set<string>>, source: string): Set<string> {
  const current = dependencies.get(source)
  if (current) return current
  const created = new Set<string>()
  dependencies.set(source, created)
  return created
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compareSource(
  left: ApplicationSpecificationAnchor,
  right: ApplicationSpecificationAnchor,
): number {
  return left.source.localeCompare(right.source)
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 500 ? message : `${message.slice(0, 500)}…`
}

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Identify a catalog source by its nearest owning package without replacing its
 * canonical catalog-file identity.
 */
export function workspacePackageCoordinate(catalogRoot: string, file: string): string | undefined {
  const root = resolve(catalogRoot)
  const source = resolve(file)
  const sourceInsideCatalog = contains(root, source)

  let directory = dirname(source)
  while (sourceInsideCatalog ? contains(root, directory) : true) {
    const packageFile = join(directory, 'package.json')
    try {
      const document: unknown = JSON.parse(readFileSync(packageFile, 'utf8'))
      if (!isPackageDocument(document)) return
      const subpath = portable(relative(directory, source))
      return subpath ? `package:${document.name}/${subpath}` : `package:${document.name}`
    } catch (error) {
      if (!isMissing(error)) return
    }

    if (sourceInsideCatalog && directory === root) break
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return
}

/**
 * Map a declaration-only DefinitelyTyped provider to the package whose public
 * TypeScript surface it implements. File suffixes remain available for source
 * navigation while package-level conformance uses the authored dependency.
 */
export function canonicalTypeProviderCoordinate(coordinate: string): string {
  if (!coordinate.startsWith('package:@types/')) return coordinate
  const parts = coordinate.slice('package:@types/'.length).split('/')
  const provider = parts.shift()
  if (!provider) return coordinate
  const separator = provider.indexOf('__')
  const packageName =
    separator < 0 ? provider : `@${provider.slice(0, separator)}/${provider.slice(separator + 2)}`
  return `package:${packageName}${parts.length ? `/${parts.join('/')}` : ''}`
}

/** Nearest package boundary containing a selected catalog, if one exists. */
export function nearestPackageRoot(directory: string): string | undefined {
  let current = resolve(directory)
  while (true) {
    const packageFile = join(current, 'package.json')
    try {
      const document: unknown = JSON.parse(readFileSync(packageFile, 'utf8'))
      if (isPackageDocument(document)) return current
      return
    } catch (error) {
      if (!isMissing(error)) return
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

function isPackageDocument(value: unknown): value is { readonly name: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { name?: unknown }).name === 'string' &&
    (value as { name: string }).name.length > 0,
  )
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function contains(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

import type ts from 'typescript'

import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import type { SourceLocation } from '../analysis/typescript/surface/model.ts'

import { workspacePackageCoordinate } from './package-coordinate.ts'

export type SourceCoordinate =
  | { readonly kind: 'catalog'; readonly file: string }
  | { readonly kind: 'external'; readonly external: string }

/**
 * Give a TypeScript source a portable identity without leaking checkout paths.
 * Catalog files remain relative paths; dependencies and compiler libraries use
 * stable package/platform coordinates.
 */
export function sourceCoordinate(catalogRoot: string, file: string): SourceCoordinate {
  const absolute = resolve(file)
  const parts = absolute.split(sep)

  if (typescriptLibrary(parts)) {
    return { kind: 'external', external: `platform:typescript/${basename(absolute)}` }
  }

  const nodeModules = parts.lastIndexOf('node_modules')
  if (nodeModules >= 0 && nodeModules + 1 < parts.length) {
    return {
      kind: 'external',
      external: `package:${parts.slice(nodeModules + 1).join('/')}`,
    }
  }

  const path = relative(resolve(catalogRoot), absolute)
  if (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)) {
    return { kind: 'catalog', file: portable(path || '.') }
  }

  const packageCoordinate = workspacePackageCoordinate(catalogRoot, absolute)
  if (packageCoordinate) return { kind: 'external', external: packageCoordinate }

  return { kind: 'external', external: `external:${basename(absolute)}` }
}

export function sourceIdentity(catalogRoot: string, file: string): string {
  const coordinate = sourceCoordinate(catalogRoot, file)
  return coordinate.kind === 'catalog' ? coordinate.file : coordinate.external
}

export function locationSource(location: SourceLocation): string {
  return location.file ?? location.external
}

export function locationOf(
  catalogRoot: string,
  node: ts.Node | ts.SourceFile | undefined,
): SourceLocation {
  if (!node) return { file: '.', line: 1, column: 1 }
  const source = node.getSourceFile()
  const start = node === source ? 0 : node.getStart(source, false)
  const position = source.getLineAndCharacterOfPosition(start)
  const coordinate = sourceCoordinate(catalogRoot, source.fileName)
  return {
    ...(coordinate.kind === 'catalog'
      ? { file: coordinate.file }
      : { external: coordinate.external }),
    line: position.line + 1,
    column: position.character + 1,
  }
}

function typescriptLibrary(parts: readonly string[]): boolean {
  const filename = parts.at(-1) ?? ''
  const library = parts.at(-2)
  const typescript = parts.at(-3)
  return (
    typescript === 'typescript' &&
    library === 'lib' &&
    /^lib(?:\.[^.]+)*\.d\.[cm]?ts$/u.test(filename)
  )
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

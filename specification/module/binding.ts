import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Diagnostic } from '../../source/diagnostic.ts'
import type { ImplementationBinding } from '../binding.ts'

import { optionalDirectFile, readBounded, sourceRevision } from '../../source/file.ts'
import { isPackageName } from '../../source/package-name.ts'

const ENTRYPOINT_NAMES = [
  'index.ts',
  'index.tsx',
  'index.mts',
  'index.cts',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
] as const

export interface ModuleBindingDiscovery {
  readonly binding?: ImplementationBinding
  readonly specifier?: string
  readonly diagnostics: readonly Diagnostic[]
  readonly revision: string
}

/** Infer a code target only from an unambiguous package entrypoint or canonical source entrypoint. */
export async function discoverModuleBinding(
  catalogRoot: string,
  specDirectory: string,
  specSource: string,
): Promise<ModuleBindingDiscovery> {
  const moduleRoot = dirname(specDirectory)
  const packageFile = join(moduleRoot, 'package.json')
  let specifier: string | undefined
  let packageEntrypoints: string[] = []
  let packageFingerprint = ''
  if (await optionalDirectFile(packageFile)) {
    try {
      const text = await readBounded(packageFile)
      const document: unknown = JSON.parse(text)
      if (!isRecord(document)) throw new Error('package.json must contain an object.')
      if (typeof document.name === 'string' && isPackageName(document.name)) {
        specifier = document.name
      }
      packageEntrypoints = await existingEntrypoints(moduleRoot, rootExportTargets(document))
      packageFingerprint = sourceRevision(
        JSON.stringify({
          specifier,
          entrypoints: packageEntrypoints.map((file) => portable(relative(moduleRoot, file))),
        }),
      )
    } catch (error) {
      return {
        diagnostics: [bindingDiagnostic('MODULE_PACKAGE_INVALID', error, specSource)],
        revision: sourceRevision(`invalid-package\0${String(error)}`),
      }
    }
  }

  const canonical = await existingEntrypoints(
    moduleRoot,
    ENTRYPOINT_NAMES.map((name) => `./src/${name}`),
  )
  const rootEntrypoints = await existingEntrypoints(
    moduleRoot,
    ENTRYPOINT_NAMES.map((name) => `./${name}`),
  )
  const selected = selectEntrypoint(packageEntrypoints, canonical, rootEntrypoints)
  if (selected.ambiguous) {
    return {
      ...(specifier ? { specifier } : {}),
      diagnostics: [
        {
          code: 'MODULE_BINDING_AMBIGUOUS',
          message: `Multiple implementation entrypoints have equal authority: ${selected.ambiguous
            .map((file) => portable(relative(catalogRoot, file)))
            .join(', ')}.`,
          file: specSource,
          line: 1,
          column: 1,
        },
      ],
      revision: sourceRevision(
        `${packageFingerprint}\0ambiguous\0${selected.ambiguous
          .map((file) => portable(relative(moduleRoot, file)))
          .join('\0')}`,
      ),
    }
  }
  if (!selected.entrypoint) {
    return {
      ...(specifier ? { specifier } : {}),
      diagnostics: [],
      revision: sourceRevision(`${packageFingerprint}\0spec-only`),
    }
  }

  const project = await nearestProject(catalogRoot, moduleRoot)
  if (!project) {
    return {
      ...(specifier ? { specifier } : {}),
      diagnostics: [
        {
          code: 'MODULE_PROJECT_MISSING',
          message: 'An implementation entrypoint exists, but no owning tsconfig.json was found.',
          file: specSource,
          line: 1,
          column: 1,
        },
      ],
      revision: sourceRevision(
        `${packageFingerprint}\0${portable(relative(moduleRoot, selected.entrypoint))}\0no-project`,
      ),
    }
  }
  const sourceRoot = within(join(moduleRoot, 'src'), selected.entrypoint)
    ? join(moduleRoot, 'src')
    : moduleRoot
  const binding: ImplementationBinding = {
    project: reference(specDirectory, project),
    root: reference(specDirectory, sourceRoot),
    entrypoint: reference(specDirectory, selected.entrypoint),
  }
  return {
    binding,
    ...(specifier ? { specifier } : {}),
    diagnostics: [],
    revision: sourceRevision(`${packageFingerprint}\0${JSON.stringify(binding)}`),
  }
}

function rootExportTargets(document: Record<string, unknown>): string[] {
  const exports = document.exports
  const rootExport =
    isRecord(exports) && Object.keys(exports).some((key) => key.startsWith('.'))
      ? exports['.']
      : exports
  return [rootExport, document.types, document.module, document.main]
    .flatMap(exportTargets)
    .filter((target) => !portable(target).split('/').includes('dist'))
}

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('./') ? [value] : []
  if (Array.isArray(value)) return value.flatMap(exportTargets)
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(exportTargets)
}

async function existingEntrypoints(root: string, references: readonly string[]): Promise<string[]> {
  const values: string[] = []
  for (const reference of references) {
    if (!reference.startsWith('./') || reference.includes('\\')) continue
    for (const candidate of sourceCandidates(resolve(root, reference))) {
      if (
        isImplementationSource(candidate) &&
        (await optionalDirectFile(candidate)) &&
        !values.includes(candidate)
      ) {
        values.push(candidate)
        break
      }
    }
  }
  return values.sort(compare)
}

function isImplementationSource(file: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/u.test(file) && !/\.d\.[cm]?ts$/u.test(file)
}

function sourceCandidates(target: string): string[] {
  const values = [target]
  if (/\.[cm]?js$/u.test(target)) {
    const base = target.replace(/\.[cm]?js$/u, '')
    values.push(`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`)
  }
  return values
}

function selectEntrypoint(
  packageEntrypoints: readonly string[],
  canonical: readonly string[],
  root: readonly string[],
): { entrypoint?: string; ambiguous?: readonly string[] } {
  for (const candidates of [packageEntrypoints, canonical, root]) {
    const unique = [...new Set(candidates)]
    if (unique.length === 1) return { entrypoint: unique[0] }
    if (unique.length > 1) return { ambiguous: unique }
  }
  return {}
}

async function nearestProject(catalogRoot: string, start: string): Promise<string | undefined> {
  const root = resolve(catalogRoot)
  let current = resolve(start)
  while (within(root, current)) {
    const project = join(current, 'tsconfig.json')
    if (await optionalDirectFile(project)) return project
    if (current === root) return
    current = dirname(current)
  }
  return
}

function reference(from: string, target: string): string {
  const path = portable(relative(from, target))
  return path.startsWith('.') ? path : `./${path}`
}

function bindingDiagnostic(code: string, error: unknown, file: string): Diagnostic {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    file,
    line: 1,
    column: 1,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function within(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target))
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

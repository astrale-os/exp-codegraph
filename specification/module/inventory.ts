import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Diagnostic } from '../../source/diagnostic.ts'

import { operationSnapshot, operationSnapshotNamespace } from '../../source/operation-snapshot.ts'

export interface ModuleFile {
  readonly absolute: string
  /** POSIX path relative to `.spec/` or `.history/`. */
  readonly relative: string
  /** POSIX path relative to the catalog root. */
  readonly source: string
}

export interface ModuleFileInventory {
  readonly api: ModuleFile
  readonly apiFragments: readonly ModuleFile[]
  readonly code?: ModuleFile
  readonly icon?: ModuleFile
  readonly internal?: ModuleFile
  readonly schemas: readonly ModuleFile[]
  readonly ports: readonly ModuleFile[]
  readonly capabilities: readonly ModuleFile[]
  readonly flows: readonly ModuleFile[]
  readonly laws: readonly ModuleFile[]
  readonly states: readonly ModuleFile[]
  readonly limits?: ModuleFile
  readonly layout?: ModuleFile
  readonly examples: readonly ModuleFile[]
  readonly benchmarks: readonly ModuleFile[]
  readonly packages: readonly ModuleFile[]
  readonly packageExceptions?: ModuleFile
  readonly architecture?: ModuleFile
  readonly history: readonly ModuleFile[]
  readonly diagnostics: readonly Diagnostic[]
  readonly historyDiagnostics: readonly Diagnostic[]
}

interface MutableInventory {
  api: ModuleFile
  apiFragments: ModuleFile[]
  code?: ModuleFile
  icon?: ModuleFile
  internal?: ModuleFile
  schemas: ModuleFile[]
  ports: ModuleFile[]
  capabilities: ModuleFile[]
  flows: ModuleFile[]
  laws: ModuleFile[]
  states: ModuleFile[]
  limits?: ModuleFile
  layout?: ModuleFile
  examples: ModuleFile[]
  benchmarks: ModuleFile[]
  packages: ModuleFile[]
  packageExceptions?: ModuleFile
  architecture?: ModuleFile
  history: ModuleFile[]
  diagnostics: Diagnostic[]
  historyDiagnostics: Diagnostic[]
}

const DIRECT_FILES: ReadonlyMap<
  string,
  'api' | 'code' | 'icon' | 'internal' | 'limits' | 'layout' | 'architecture'
> = new Map([
  ['api.d.ts', 'api'],
  ['code.ts', 'code'],
  ['icon.svg', 'icon'],
  ['internal.d.ts', 'internal'],
  ['limits.ts', 'limits'],
  ['layout.ts', 'layout'],
  ['architecture.md', 'architecture'],
] as const)

const DIRECTORIES = {
  api: (name: string) => name.endsWith('.d.ts'),
  schemas: (name: string) => name.endsWith('.schema.json'),
  ports: (name: string) => name.endsWith('.d.ts'),
  capabilities: (name: string) => name.endsWith('.ts'),
  flows: (name: string) => name.endsWith('.ts'),
  laws: (name: string) => name.endsWith('.ts'),
  states: (name: string) => name.endsWith('.ts'),
  examples: (name: string) => name.endsWith('.ts'),
  benchmarks: (name: string) => name.endsWith('.ts'),
  packages: (name: string) => name.endsWith('.ts'),
} as const

const inventories = operationSnapshotNamespace<Promise<ModuleFileInventory>>('module-inventories')

/** Discover the closed normative `.spec/` grammar and the open sibling `.history/` tree. */
export async function inventoryModuleFiles(
  catalogRoot: string,
  specDirectory: string,
): Promise<ModuleFileInventory> {
  const snapshot = operationSnapshot(inventories)
  if (!snapshot) return inventoryModuleFilesFresh(catalogRoot, specDirectory)
  const key = `${resolve(catalogRoot)}\0${resolve(specDirectory)}`
  const current = snapshot.get(key)
  if (current) return current
  const inventory = inventoryModuleFilesFresh(catalogRoot, specDirectory)
  snapshot.set(key, inventory)
  return inventory
}

async function inventoryModuleFilesFresh(
  catalogRoot: string,
  specDirectory: string,
): Promise<ModuleFileInventory> {
  const root = await realpath(resolve(catalogRoot))
  const spec = await realpath(resolve(specDirectory))
  if (basename(spec) !== '.spec' || !within(root, spec)) {
    throw new Error('A convention-based module specification must be a .spec directory.')
  }
  const api = moduleFile(root, spec, join(spec, 'api.d.ts'))
  const output: MutableInventory = {
    api,
    apiFragments: [],
    schemas: [],
    ports: [],
    capabilities: [],
    flows: [],
    laws: [],
    states: [],
    examples: [],
    benchmarks: [],
    packages: [],
    history: [],
    diagnostics: [],
    historyDiagnostics: [],
  }

  const entries = await sortedEntries(spec)
  for (const entry of entries) {
    const target = join(spec, entry.name)
    if (entry.isSymbolicLink()) {
      output.diagnostics.push(
        inventoryDiagnostic(
          'MODULE_SPEC_SYMBOLIC_LINK',
          'Normative specification paths cannot contain symbolic links.',
          portable(relative(root, target)),
        ),
      )
      continue
    }
    if (entry.isFile()) {
      const field = DIRECT_FILES.get(entry.name)
      if (!field) {
        output.diagnostics.push(
          inventoryDiagnostic(
            'MODULE_SPEC_ARTIFACT_UNKNOWN',
            `Unknown top-level specification artifact: ${entry.name}`,
            portable(relative(root, target)),
          ),
        )
        continue
      }
      output[field] = moduleFile(root, spec, target) as never
      continue
    }
    if (!entry.isDirectory() || !(entry.name in DIRECTORIES)) {
      output.diagnostics.push(
        inventoryDiagnostic(
          'MODULE_SPEC_ARTIFACT_UNKNOWN',
          `Unknown top-level specification directory: ${entry.name}`,
          portable(relative(root, target)),
        ),
      )
      continue
    }
    const owner = entry.name as keyof typeof DIRECTORIES
    const files = await walkTypedDirectory(
      root,
      spec,
      target,
      owner,
      DIRECTORIES[owner],
      output.diagnostics,
    )
    if (owner === 'api') {
      output.apiFragments.push(...files)
    } else if (owner === 'packages') {
      for (const file of files) {
        if (file.relative === 'packages/exceptions.ts') output.packageExceptions = file
        else output.packages.push(file)
      }
    } else {
      output[owner].push(...files)
    }
  }

  const historyDirectory = join(dirname(spec), '.history')
  try {
    const historyMetadata = await lstat(historyDirectory)
    if (historyMetadata.isSymbolicLink()) {
      throw new Error('History directory cannot be a symbolic link.')
    }
    const canonicalHistory = await realpath(historyDirectory)
    if (!within(root, canonicalHistory)) throw new Error('History directory escapes the catalog.')
    output.history.push(
      ...(await walkHistoryDirectory(
        root,
        canonicalHistory,
        canonicalHistory,
        output.historyDiagnostics,
      )),
    )
  } catch (error) {
    if (!isMissing(error)) {
      output.historyDiagnostics.push(
        inventoryDiagnostic(
          'HISTORY_DIRECTORY_INVALID',
          error instanceof Error ? error.message : String(error),
          portable(relative(root, historyDirectory)),
        ),
      )
    }
  }

  return output
}

async function walkTypedDirectory(
  root: string,
  spec: string,
  directory: string,
  owner: keyof typeof DIRECTORIES,
  accepts: (name: string) => boolean,
  diagnostics: Diagnostic[],
): Promise<ModuleFile[]> {
  const files: ModuleFile[] = []
  const entries = await sortedEntries(directory)
  if (entries.length === 0) {
    diagnostics.push(
      inventoryDiagnostic(
        'MODULE_SPEC_DIRECTORY_EMPTY',
        `Remove the empty optional ${owner} directory.`,
        portable(relative(root, directory)),
      ),
    )
  }
  for (const entry of entries) {
    const target = join(directory, entry.name)
    const source = portable(relative(root, target))
    if (entry.isSymbolicLink()) {
      diagnostics.push(
        inventoryDiagnostic(
          'MODULE_SPEC_SYMBOLIC_LINK',
          'Normative specification paths cannot contain symbolic links.',
          source,
        ),
      )
    } else if (entry.isDirectory()) {
      files.push(...(await walkTypedDirectory(root, spec, target, owner, accepts, diagnostics)))
    } else if (!entry.isFile() || !accepts(entry.name)) {
      diagnostics.push(
        inventoryDiagnostic(
          'MODULE_SPEC_FILE_INVALID',
          `Invalid ${owner} artifact: ${portable(relative(spec, target))}`,
          source,
        ),
      )
    } else {
      files.push(moduleFile(root, spec, target))
    }
  }
  return files
}

async function walkHistoryDirectory(
  root: string,
  base: string,
  directory: string,
  diagnostics: Diagnostic[],
): Promise<ModuleFile[]> {
  const files: ModuleFile[] = []
  for (const entry of await sortedEntries(directory)) {
    const target = join(directory, entry.name)
    const source = portable(relative(root, target))
    if (entry.isSymbolicLink()) {
      diagnostics.push(
        inventoryDiagnostic(
          'HISTORY_SYMBOLIC_LINK',
          'History paths cannot contain symbolic links.',
          source,
        ),
      )
    } else if (entry.isDirectory()) {
      files.push(...(await walkHistoryDirectory(root, base, target, diagnostics)))
    } else if (entry.isFile()) {
      files.push({
        absolute: target,
        relative: portable(relative(base, target)),
        source,
      })
    }
  }
  return files
}

async function sortedEntries(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.sort((left, right) => compare(left.name, right.name))
}

function moduleFile(root: string, spec: string, absolute: string): ModuleFile {
  return {
    absolute,
    relative: portable(relative(spec, absolute)),
    source: portable(relative(root, absolute)),
  }
}

function inventoryDiagnostic(code: string, message: string, file: string): Diagnostic {
  return { code, message, file, line: 1, column: 1 }
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SKIP = new Set([
  '.context',
  '.history',
  '.git',
  '.next',
  '.turbo',
  '__tests__',
  'coverage',
  'dist',
  'node_modules',
])
const SNAPSHOT_ARTIFACT_PARENTS = new Set(['benchmark', 'evidence'])

export interface ApplicationDiscoveryOptions {
  /** Root-relative directory trees pruned before filesystem traversal. */
  readonly exclude?: readonly string[]
}

/** Resolve and validate the physical application root without making it part of portable identity. */
export async function resolveApplicationRoot(input: string): Promise<string> {
  const root = await realpath(resolve(input))
  if (!(await stat(root)).isDirectory()) throw new Error('Root must be a directory.')
  return root
}

/** Discover only convention-owned `.spec/api.d.ts` anchors in deterministic lexical order. */
export async function discoverSpecificationDirectories(
  directory: string,
  options: ApplicationDiscoveryOptions = {},
): Promise<string[]> {
  const excluded = excludedDirectories(directory, options.exclude ?? [])
  return discover(directory, excluded)
}

async function discover(directory: string, excluded: readonly string[]): Promise<string[]> {
  if (isExcluded(directory, excluded)) return []
  const found: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => compare(left.name, right.name))
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const module = basename(directory) === '.spec' && files.has('api.d.ts')
  if (module) found.push(directory)
  if (module) return found
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !skipDirectory(directory, entry.name)) {
      found.push(...(await discover(path, excluded)))
    }
  }
  return found
}

function skipDirectory(parent: string, name: string): boolean {
  if (SKIP.has(name) || (name.startsWith('.') && name !== '.spec')) return true
  const parentName = basename(parent)
  return (
    (parentName === 'qualification' && name === 'evidence') ||
    (name === 'artifacts' && SNAPSHOT_ARTIFACT_PARENTS.has(parentName))
  )
}

function excludedDirectories(root: string, inputs: readonly string[]): string[] {
  return inputs.map((input) => {
    if (!input || isAbsolute(input)) {
      throw new Error('Excluded application paths must be non-empty and relative to the root.')
    }
    const target = resolve(root, input)
    const path = relative(resolve(root), target)
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error(`Excluded application path escapes the root: ${input}`)
    }
    return target
  })
}

function isExcluded(directory: string, excluded: readonly string[]): boolean {
  if (!excluded.length) return false
  const target = resolve(directory)
  return excluded.some((root) => target === root || target.startsWith(`${root}${sep}`))
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

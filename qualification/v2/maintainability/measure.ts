import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'

const execFile = promisify(execFileCallback)

export interface MaintainabilityScope {
  readonly sourceExtensions: readonly string[]
  readonly excludedSegments: readonly string[]
  readonly excludedSuffixes: readonly string[]
}

export interface MaintainabilityMeasurement {
  readonly format: 'astrale.codegraph.maintainability-measurement'
  readonly version: 1
  readonly revision: string
  readonly scope: MaintainabilityScope
  readonly files: number
  readonly directories: number
  readonly physicalLines: number
  readonly sizeBands: Readonly<Record<'over250' | 'over500' | 'over1000' | 'over2000', number>>
  readonly largest: readonly (readonly [string, number])[]
  readonly relativeImportCycles: readonly (readonly string[])[]
  readonly boundaryDefinitions: number
  readonly repeatedBoundaryNames: readonly (readonly [string, number])[]
  readonly optimizationFiles: readonly string[]
  readonly optimizationImports: readonly (readonly [string, string])[]
}

export const MAINTAINABILITY_SCOPE: MaintainabilityScope = Object.freeze({
  sourceExtensions: ['.ts', '.tsx', '.go', '.mjs'],
  excludedSegments: [
    '__tests__',
    'dist',
    'node_modules',
    'native-packages',
    'qualification',
    'scripts',
    '.history',
    '.spec',
  ],
  excludedSuffixes: [
    '.test.ts',
    '.test.tsx',
    '.spec.ts',
    '.spec.tsx',
    '.config.ts',
    '.config.tsx',
  ],
})

export async function measureMaintainability(
  root: string,
  revision = 'worktree',
): Promise<MaintainabilityMeasurement> {
  root = resolve(root)
  const paths = (await sourcePaths(root, revision)).filter(inScope).sort()
  const sources = new Map(
    await mapBounded(paths, 8, async (path) => [path, await sourceText(root, revision, path)] as const),
  )
  const rows = [...sources].map(([path, source]) => [path, physicalLines(source)] as const)
  rows.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const boundaryNames = new Map<string, number>()
  const optimizationImports: Array<readonly [string, string]> = []
  const graph = new Map<string, readonly string[]>()
  for (const [path, source] of sources) {
    for (const name of boundaryDefinitions(source)) {
      boundaryNames.set(name, (boundaryNames.get(name) ?? 0) + 1)
    }
    const imports = staticImports(path, source)
    graph.set(path, imports.flatMap((specifier) => resolveImport(path, specifier, sources)))
    for (const specifier of imports.filter((value) => value.includes('.optimization'))) {
      optimizationImports.push([path, specifier])
    }
  }
  const directories = new Set(paths.map(dirname))
  return {
    format: 'astrale.codegraph.maintainability-measurement',
    version: 1,
    revision,
    scope: MAINTAINABILITY_SCOPE,
    files: paths.length,
    directories: directories.size,
    physicalLines: rows.reduce((total, row) => total + row[1], 0),
    sizeBands: {
      over250: rows.filter((row) => row[1] > 250).length,
      over500: rows.filter((row) => row[1] > 500).length,
      over1000: rows.filter((row) => row[1] > 1_000).length,
      over2000: rows.filter((row) => row[1] > 2_000).length,
    },
    largest: rows.slice(0, 20),
    relativeImportCycles: importCycles(graph),
    boundaryDefinitions: [...boundaryNames.values()].reduce((total, count) => total + count, 0),
    repeatedBoundaryNames: [...boundaryNames]
      .filter((entry) => entry[1] > 1)
      .sort(([left], [right]) => left.localeCompare(right)),
    optimizationFiles: paths.filter((path) => path.endsWith('.optimization.ts')),
    optimizationImports: optimizationImports.sort(([left], [right]) => left.localeCompare(right)),
  }
}

async function mapBounded<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const output = new Array<Output>(values.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = next++
        if (index >= values.length) return
        output[index] = await transform(values[index]!)
      }
    }),
  )
  return output
}

function inScope(path: string): boolean {
  return (
    MAINTAINABILITY_SCOPE.sourceExtensions.includes(extname(path)) &&
    !path.split('/').some((segment) => MAINTAINABILITY_SCOPE.excludedSegments.includes(segment)) &&
    !MAINTAINABILITY_SCOPE.excludedSuffixes.some((suffix) => path.endsWith(suffix))
  )
}

async function sourcePaths(root: string, revision: string): Promise<readonly string[]> {
  const args =
    revision === 'worktree'
      ? ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
      : ['ls-tree', '-r', '--name-only', '-z', revision]
  const { stdout } = await execFile('git', ['-C', root, ...args], {
    encoding: 'buffer',
    maxBuffer: 64 * 1_024 * 1_024,
  })
  return Buffer.from(stdout).toString('utf8').split('\0').filter(Boolean)
}

async function sourceText(root: string, revision: string, path: string): Promise<string> {
  if (revision === 'worktree') return readFile(join(root, ...path.split('/')), 'utf8')
  const { stdout } = await execFile('git', ['-C', root, 'show', `${revision}:${path}`], {
    encoding: 'buffer',
    maxBuffer: 16 * 1_024 * 1_024,
  })
  return Buffer.from(stdout).toString('utf8')
}

function physicalLines(source: string): number {
  if (!source) return 0
  return source.split(/\r?\n/u).length - (source.endsWith('\n') ? 1 : 0)
}

function boundaryDefinitions(source: string): readonly string[] {
  return [...source.matchAll(/\b(?:function|class|const)\s+((?:decode|admit|validate|assert|capture|verify)[A-Z][A-Za-z0-9_]*)/gu)]
    .map((match) => match[1]!)
}

function staticImports(path: string, source: string): readonly string[] {
  if (!path.endsWith('.ts') && !path.endsWith('.tsx')) {
    return [...source.matchAll(/\b(?:from|import)\s*[(']?\s*['"]([^'"]+)['"]/gu)]
      .map((match) => match[1]!)
      .filter(relativeImport)
  }
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const values: string[] = []
  for (const statement of file.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      relativeImport(statement.moduleSpecifier.text)
    ) {
      values.push(statement.moduleSpecifier.text)
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      relativeImport(statement.moduleReference.expression.text)
    ) {
      values.push(statement.moduleReference.expression.text)
    }
  }
  return values
}

function resolveImport(
  source: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): readonly string[] {
  const base = portable(normalize(join(dirname(source), specifier)))
  const candidates = [
    base,
    ...MAINTAINABILITY_SCOPE.sourceExtensions.map((extension) => `${base}${extension}`),
    ...MAINTAINABILITY_SCOPE.sourceExtensions.map((extension) => `${base}/index${extension}`),
  ]
  return candidates.flatMap((candidate) => (sources.has(candidate) ? [candidate] : [])).slice(0, 1)
}

function relativeImport(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../')
}

function portable(path: string): string {
  const value = sep === '/' ? path : path.split(sep).join('/')
  return value.startsWith('./') ? value.slice(2) : value
}

function importCycles(graph: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[] {
  let nextIndex = 0
  const indices = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const active = new Set<string>()
  const cycles: string[][] = []
  const visit = (node: string): void => {
    indices.set(node, nextIndex)
    low.set(node, nextIndex++)
    stack.push(node)
    active.add(node)
    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target)
        low.set(node, Math.min(low.get(node)!, low.get(target)!))
      } else if (active.has(target)) {
        low.set(node, Math.min(low.get(node)!, indices.get(target)!))
      }
    }
    if (low.get(node) !== indices.get(node)) return
    const component: string[] = []
    while (stack.length) {
      const member = stack.pop()!
      active.delete(member)
      component.push(member)
      if (member === node) break
    }
    component.sort()
    if (component.length > 1 || (graph.get(node) ?? []).includes(node)) cycles.push(component)
  }
  for (const node of [...graph.keys()].sort()) if (!indices.has(node)) visit(node)
  return cycles.sort((left, right) => left[0]!.localeCompare(right[0]!))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(argument('--root') ?? '.')
  const revision = argument('--revision') ?? 'worktree'
  process.stdout.write(`${JSON.stringify(await measureMaintainability(root, revision), null, 2)}\n`)
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

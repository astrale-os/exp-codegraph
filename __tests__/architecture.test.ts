import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const excluded = new Set(['__tests__', 'dist', 'node_modules'])

describe('module architecture', () => {
  it('keeps the root surface and barrel files structural', async () => {
    const entries = await readdir(root, { withFileTypes: true })
    const rootModules = entries
      .filter((entry) => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
      .map((entry) => entry.name)
      .sort()
    expect(rootModules).toEqual(['cli.ts', 'index.ts'])

    const files = await sourceFiles(root)
    for (const file of files.filter((candidate) => candidate.endsWith(`${sep}index.ts`))) {
      const source = await readFile(file, 'utf8')
      expect(source).not.toMatch(
        /^\s*(?:import\b|const\b|let\b|var\b|function\b|class\b|interface\b|type\s+\w+\s*=)/m,
      )
    }
    expect(
      files.filter((file) => /(?:-utils|-helpers|-common|-types)\.[jt]sx?$/.test(file)),
    ).toEqual([])
  })

  it('keeps one extensible analysis model and no retired authority implementation', async () => {
    const files = await sourceFiles(root)
    const surface = await readFile(
      join(root, 'analysis', 'typescript', 'surface', 'model.ts'),
      'utf8',
    )

    expect(files.map((file) => portable(relative(root, file)))).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(?:catalog|code|editing|reveal|verification)\//u),
        'typescript/model.ts',
      ]),
    )
    expect(surface).toContain("'bigint'")
    expect(surface).toContain("'symbol'")
    expect(surface).toContain("'object'")
    expect(surface).toContain("kind: 'bigint-literal'")
  })

  it('has no static relative-import cycles', async () => {
    const files = await sourceFiles(root)
    const fileSet = new Set(files)
    const edges = new Map<string, string[]>()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      edges.set(
        file,
        relativeImports(source)
          .map((specifier) => resolve(dirname(file), specifier))
          .filter((target) => fileSet.has(target)),
      )
    }

    const active = new Set<string>()
    const complete = new Set<string>()
    const trail: string[] = []
    const visit = (file: string): string[] | undefined => {
      if (active.has(file)) return [...trail.slice(trail.indexOf(file)), file]
      if (complete.has(file)) return
      active.add(file)
      trail.push(file)
      for (const dependency of edges.get(file) ?? []) {
        const cycle = visit(dependency)
        if (cycle) return cycle
      }
      trail.pop()
      active.delete(file)
      complete.add(file)
      return
    }

    let cycle: string[] | undefined
    for (const file of files) {
      cycle = visit(file)
      if (cycle) break
    }
    expect(cycle?.map((file) => portable(relative(root, file)))).toBeUndefined()
  })

  it('keeps recursive conformance comparison in bounded hierarchical leaves', async () => {
    const comparisonRoot = join(root, 'conformance', 'module', 'comparison')
    const oversized: string[] = []
    for (const file of await sourceFiles(comparisonRoot)) {
      const lines = (await readFile(file, 'utf8')).split('\n').length
      if (lines > 2_000) oversized.push(`${portable(relative(comparisonRoot, file))}: ${lines}`)
    }
    expect(oversized).toEqual([])
  })

  it('keeps top-level contexts in the declared acyclic knowledge order', async () => {
    const allowed: Record<string, ReadonlySet<string>> = {
      analysis: new Set(),
      api: new Set(['analysis', 'source', 'typescript']),
      application: new Set([
        'analysis',
        'conformance',
        'repository',
        'schema',
        'source',
        'specification',
      ]),
      authoring: new Set(),
      cache: new Set(),
      cli: new Set(['application', 'cache', 'conformance', 'server', 'source', 'viewer-host']),
      compiler: new Set(['api', 'cache', 'source', 'typescript']),
      conformance: new Set(['analysis', 'source', 'specification']),
      'json-schema': new Set(['api']),
      markdown: new Set(['source']),
      qualification: new Set([
        'analysis',
        'application',
        'conformance',
        'source',
        'specification',
      ]),
      reference: new Set(),
      repository: new Set(['analysis', 'source']),
      schema: new Set(['source']),
      scripts: new Set(['qualification']),
      server: new Set([
        'analysis',
        'api',
        'application',
        'cache',
        'conformance',
        'markdown',
        'repository',
        'source',
        'specification',
        'viewer-host',
      ]),
      source: new Set(['reference']),
      specification: new Set([
        'analysis',
        'api',
        'authoring',
        'cache',
        'compiler',
        'markdown',
        'schema',
        'source',
        'typescript',
      ]),
      typescript: new Set(['analysis']),
      viewer: new Set([
        'api',
        'application',
        'markdown',
        'reference',
        'source',
        'specification',
        'viewer-host',
      ]),
      'viewer-host': new Set(['api', 'application', 'source', 'specification']),
    }
    const files = await sourceFiles(root)
    const contexts = [...new Set(files.map(contextOf).filter((value): value is string => Boolean(value)))].sort()
    expect(contexts).toEqual(Object.keys(allowed).sort())
    const violations: string[] = []
    const contextEdges = new Map<string, Set<string>>()
    for (const file of files) {
      const sourceContext = contextOf(file)
      if (!sourceContext || !allowed[sourceContext]) continue
      const source = await readFile(file, 'utf8')
      for (const specifier of relativeImports(source)) {
        const targetContext = contextOf(resolve(dirname(file), specifier))
        if (
          targetContext &&
          targetContext !== sourceContext
        ) {
          const current = contextEdges.get(sourceContext) ?? new Set<string>()
          current.add(targetContext)
          contextEdges.set(sourceContext, current)
          if (!allowed[sourceContext].has(targetContext)) {
            violations.push(
              `${portable(relative(root, file))} -> ${portable(relative(root, resolve(dirname(file), specifier)))}`,
            )
          }
        }
      }
    }
    expect(violations).toEqual([])
    expect(contextCycle(contextEdges)).toBeUndefined()
  })
})

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const file = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(file)))
    else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) files.push(file)
  }
  return files.sort()
}

function relativeImports(source: string): string[] {
  const imports: string[] = []
  const pattern = /(?:\bfrom\s*|\bimport\s*\()(['"])(\.[^'"]+)\1/g
  for (const match of source.matchAll(pattern)) imports.push(match[2]!)
  return imports
}

function contextOf(file: string): string | undefined {
  const path = portable(relative(root, file))
  const first = path.split('/')[0]
  return first && !first.includes('.') ? first : undefined
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function contextCycle(edges: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] | undefined {
  const active = new Set<string>()
  const complete = new Set<string>()
  const trail: string[] = []
  const visit = (context: string): readonly string[] | undefined => {
    if (active.has(context)) return [...trail.slice(trail.indexOf(context)), context]
    if (complete.has(context)) return
    active.add(context)
    trail.push(context)
    for (const dependency of edges.get(context) ?? []) {
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    trail.pop()
    active.delete(context)
    complete.add(context)
  }
  for (const context of edges.keys()) {
    const cycle = visit(context)
    if (cycle) return cycle
  }
}

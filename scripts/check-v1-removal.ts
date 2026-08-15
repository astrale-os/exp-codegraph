import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const retiredRoots = ['catalog', 'code', 'editing', 'profile', 'reveal', 'verification']
const diagnostics: string[] = []

for (const retired of retiredRoots) {
  if (await exists(join(root, retired))) {
    diagnostics.push(`${retired}:1:1 [V1_AUTHORITY_ROOT_PRESENT] Retired authority root remains.`)
  }
}

for (const retired of ['specification/model.ts', 'typescript/model.ts']) {
  if (await exists(join(root, retired))) {
    diagnostics.push(`${retired}:1:1 [V1_AUTHORITY_FILE_PRESENT] Retired authority file remains.`)
  }
}

const runtimeRoots = [
  'analysis',
  'api',
  'application',
  'authoring',
  'cache',
  'cli',
  'compiler',
  'conformance',
  'json-schema',
  'markdown',
  'reference',
  'repository',
  'schema',
  'server',
  'source',
  'specification',
  'typescript',
  'viewer',
  'viewer-host',
]
for (const directory of runtimeRoots) {
  for (const file of await sourceFiles(join(root, directory))) {
    const path = portable(relative(root, file))
    const source = await readFile(file, 'utf8')
    for (const forbidden of ['LegacySpecification', 'manifest-v1', 'SPEC.yml']) {
      if (source.includes(forbidden)) {
        diagnostics.push(`${path}:1:1 [V1_SYMBOL_PRESENT] Runtime source contains ${forbidden}.`)
      }
    }
    if (
      source.includes('@astrale-os/spec/authoring') &&
      path !== 'specification/module/authoring-syntax.ts'
    ) {
      diagnostics.push(
        `${path}:1:1 [V1_AUTHORING_IMPORT_PRESENT] Old authoring spelling is allowed only in the inert syntax recognizer.`,
      )
    }
  }
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  readonly name?: unknown
  readonly bin?: Readonly<Record<string, unknown>>
}
if (manifest.name !== '@astrale-os/codegraph') {
  diagnostics.push('package.json:1:1 [PACKAGE_NAME_INVALID] Expected @astrale-os/codegraph.')
}
if (manifest.bin?.cg !== './dist/cli.js') {
  diagnostics.push('package.json:1:1 [CLI_NAME_INVALID] Expected cg to resolve to ./dist/cli.js.')
}

for (const diagnostic of diagnostics.sort()) process.stderr.write(`${diagnostic}\n`)
process.stdout.write(
  `Checked V1 authority removal: ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}.\n`,
)
process.exitCode = diagnostics.length ? 1 : 0

async function sourceFiles(directory: string): Promise<readonly string[]> {
  if (!(await exists(directory))) return []
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (entry.isFile() && ['.js', '.mjs', '.ts', '.tsx'].includes(extname(entry.name))) {
      files.push(path)
    }
  }
  return files.sort()
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

function portable(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

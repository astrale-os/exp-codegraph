import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import {
  declarationLiteralVersion,
  isSpecificationSourcePath,
  staleVersionReferences,
  type VersionReferenceSource,
  type VersionReferenceTerm,
} from '../qualification/version-reference.ts'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const queryApi = 'core/graph/query/language/.spec/api.d.ts'
const planApi = 'ports/query/.spec/api.d.ts'

const queryVersion = declarationLiteralVersion(
  queryApi,
  await readFile(resolve(root, queryApi), 'utf8'),
  'QueryAST.version',
)
const planVersion = declarationLiteralVersion(
  planApi,
  await readFile(resolve(root, planApi), 'utf8'),
  'QUERY_PLAN_VERSION',
)
const sources = await specificationSources(root)
const terms: VersionReferenceTerm[] = [
  {
    name: 'Query',
    current: queryVersion,
    patterns: [/\bQuery(?:AST| AST)? V(?<version>\d+)\b/gu],
  },
  {
    name: 'Query Plan',
    current: planVersion,
    patterns: [/\bQuery Plan V(?<version>\d+)\b/gu],
  },
  {
    name: 'Query Plan',
    current: planVersion,
    patterns: [/\bPlan V(?<version>\d+)\b/gu],
    roots: ['core/graph/query/', 'ports/query/', 'runtime/query/'],
  },
]
const diagnostics = staleVersionReferences(sources, terms)

for (const diagnostic of diagnostics) {
  process.stderr.write(
    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}\n`,
  )
}
process.stdout.write(
  `Checked Query and Query Plan version references: ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}.\n`,
)
process.exitCode = diagnostics.length ? 1 : 0

async function specificationSources(workspace: string): Promise<VersionReferenceSource[]> {
  const { stdout } = await exec(
    'git',
    ['-C', workspace, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  const files = stdout.split('\0').filter(isSpecificationSourcePath).sort(compare)
  const sources = await Promise.all(files.map((file) => readSource(workspace, file)))
  return sources.flatMap((source) => (source === undefined ? [] : [source]))
}

async function readSource(
  workspace: string,
  file: string,
): Promise<VersionReferenceSource | undefined> {
  try {
    return {
      file: portable(relative(workspace, resolve(workspace, file))),
      text: await readFile(resolve(workspace, file), 'utf8'),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function portable(path: string): string {
  return path.split(sep).join('/')
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

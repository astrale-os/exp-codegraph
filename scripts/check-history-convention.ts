import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const { stdout } = await exec(
  'git',
  ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
)
const files = stdout.split('\0').filter(Boolean).sort(compare)
const diagnostics: string[] = []
const legacyLiteralOwners = new Set([
  'dsl/__tests__/dependencies.test.ts',
  'application/discovery/discover.ts',
  'dist/application/discovery/discover.js',
  'dist/specification/module/layout.js',
  'code/analyze.ts',
  'scripts/check-history-convention.ts',
  'specification/module/layout.ts',
])
const retained =
  'backend/falkordb/evidence/retained/2026-08-12-falkordb-41807-sparse-v2-full-r5/checksums.sha256'
const retainedSha256 = '6adec67ff6f4a92d3175a83696260504b1a6a3fa6ef11b07b689e605f698dc65'
const legacyReferenceCounts = new Map([['scripts/check-history-convention.ts', 3]])
const obsoleteModuleNames = [
  'Context' + 'Presentation',
  'Context' + 'Resource',
  'context' + 'Diagnostics',
  'loadContext' + 'Resource',
  'CONTEXT_RESOURCE' + '_ENDPOINT',
]

for (const file of files) {
  if (/(^|\/)\.context(\/|$)/u.test(file)) {
    diagnostics.push(`${file}:1:1 [LEGACY_CONTEXT_PATH] Temporal records must use .history/.`)
    continue
  }
  let bytes: Buffer
  try {
    bytes = await readFile(resolve(root, file))
  } catch (error) {
    // `git ls-files --cached` retains a tracked path deleted in the worktree. A deletion cannot
    // reintroduce the legacy convention and must not make the negative scan crash before the
    // removal is committed.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
    throw error
  }
  if (bytes.includes(0)) continue
  const text = bytes.toString('utf8')
  const matches = text.match(/\.context\//gu) ?? []
  const quoted = text.match(/(['"`])\.context\1/gu) ?? []
  if (file === retained) {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (matches.length !== 136 || quoted.length || sha256 !== retainedSha256) {
      diagnostics.push(
        `${file}:1:1 [RETAINED_CONTEXT_PROVENANCE_CHANGED] Expected the immutable retained checksum manifest with exactly 136 .context/ paths.`,
      )
    }
    continue
  }
  const expectedReferences = legacyReferenceCounts.get(file)
  if (expectedReferences !== undefined) {
    if (matches.length !== expectedReferences) {
      diagnostics.push(
        `${file}:1:1 [LEGACY_CONTEXT_SENTINEL_CHANGED] Expected exactly ${expectedReferences} .context/ sentinels.`,
      )
    }
    continue
  }
  if (matches.length) {
    diagnostics.push(`${file}:1:1 [LEGACY_CONTEXT_REFERENCE] Replace .context/ with .history/.`)
  }
  if (quoted.length && !legacyLiteralOwners.has(file)) {
    diagnostics.push(`${file}:1:1 [LEGACY_CONTEXT_LITERAL] Replace the .context convention literal.`)
  }
  for (const name of obsoleteModuleNames) {
    if (text.includes(name)) {
      diagnostics.push(`${file}:1:1 [LEGACY_CONTEXT_MODULE_NAME] Replace obsolete module-v2 name ${name}.`)
    }
  }
}

for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic}\n`)
process.stdout.write(`Checked temporal history convention: ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}.\n`)
process.exitCode = diagnostics.length ? 1 : 0

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

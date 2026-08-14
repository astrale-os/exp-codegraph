import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import { validateV2Governance } from '../qualification/v2-governance.ts'

const root = resolve(import.meta.dirname, '..')
const governanceRoot = resolve(root, '.history/v2')
const requirementsPath = resolve(governanceRoot, 'requirements.tsv')
const gatesPath = resolve(governanceRoot, 'gates.tsv')
const driftPath = resolve(governanceRoot, 'drift.tsv')
const adrPath = resolve(root, '.history/adr/typespec-v2.md')
const revisionsRoot = resolve(governanceRoot, 'revisions')
const requirementsText = await readFile(requirementsPath, 'utf8')
const gatesText = await readFile(gatesPath, 'utf8')
const driftText = await readFile(driftPath, 'utf8')
const adrText = await readFile(adrPath, 'utf8')
const referencedPaths = pathLocators(requirementsText, gatesText, driftText)
const existingPaths = new Set<string>()

for (const path of referencedPaths) {
  try {
    if ((await stat(resolve(root, path))).isFile()) existingPaths.add(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const revisionTexts = new Map<string, string>()
for (const entry of await readdir(revisionsRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue
  const absolute = resolve(revisionsRoot, entry.name)
  revisionTexts.set(portable(relative(root, absolute)), await readFile(absolute, 'utf8'))
}

const result = validateV2Governance({
  requirementsText,
  gatesText,
  driftText,
  adrText,
  existingPaths,
  revisionTexts,
})

for (const diagnostic of result.diagnostics) {
  process.stderr.write(
    `.history/v2/${diagnostic.source}:${diagnostic.line}:1 [${diagnostic.code}] ${diagnostic.message}\n`,
  )
}
process.stdout.write(
  `Checked TypeSpec V2 governance: ${result.requirements.length} requirements, ${result.gates.length} gates, ${result.drift.length} drift decisions, ${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? '' : 's'}.\n`,
)
process.exitCode = result.diagnostics.length ? 1 : 0

function pathLocators(requirements: string, gates: string, drift: string): ReadonlySet<string> {
  const paths = new Set<string>([
    '.history/adr/typespec-v2.md',
    '.history/v2/GOVERNANCE.md',
    '.history/v2/baseline.md',
    '.history/v2/gates.tsv',
    '.history/v2/drift.tsv',
    '.history/v2/requirements.tsv',
  ])
  for (const [text, columns] of [
    [requirements, [7, 8, 9, 10]],
    [gates, [4]],
    [drift, [7, 8]],
  ] as const) {
    for (const line of text.replace(/\r\n?/gu, '\n').split('\n').slice(1)) {
      if (!line) continue
      const values = line.split('\t')
      for (const column of columns) {
        for (const path of (values[column] ?? '').split(';')) {
          const normalized = path.trim()
          if (normalized && normalized !== '-') paths.add(normalized)
        }
      }
    }
  }
  return paths
}

function portable(path: string): string {
  return path.split(sep).join('/')
}

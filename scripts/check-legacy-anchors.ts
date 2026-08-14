import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const { stdout } = await exec(
  'git',
  [
    '-C',
    root,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    'SPEC.yml',
    ':(glob)**/SPEC.yml',
  ],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
)
const anchors = stdout.split('\0').filter(Boolean).sort(compare)
for (const anchor of anchors) {
  process.stderr.write(
    `${anchor}:1:1 [LEGACY_SPECIFICATION_TRACKED] Live specification authoring must use .spec/api.d.ts.\n`,
  )
}
process.stdout.write(
  `Checked legacy specification anchors: ${anchors.length} diagnostic${anchors.length === 1 ? '' : 's'}.\n`,
)
process.exitCode = anchors.length ? 1 : 0

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

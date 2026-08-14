import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const catalog = resolve(root, 'cli.ts')
const legacy = resolve(root, 'scripts/check-legacy-anchors.ts')
const history = resolve(root, 'scripts/check-history-convention.ts')
const forwarded = process.argv.slice(2)
const catalogExit = await run(catalog, [
  'changed',
  '.',
  ...forwarded,
  '--require-complete-layout',
  '--exclude',
  'backend/falkordb/evidence/artifacts',
  '--exclude',
  'backend/falkordb/benchmark/artifacts',
])
const shouldQualify = catalogExit === 0 && !forwarded.includes('--scope-only')
const legacyExit = shouldQualify ? await run(legacy, []) : catalogExit
process.exitCode = legacyExit === 0 && shouldQualify ? await run(history, []) : legacyExit

function run(script: string, args: readonly string[]): Promise<number> {
  return new Promise((complete, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=1280', script, ...args], {
      cwd: root,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal)
      complete(code ?? 1)
    })
  })
}

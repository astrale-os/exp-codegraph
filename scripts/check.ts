import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const catalog = resolve(root, 'cli.ts')
const legacy = resolve(root, 'scripts/check-legacy-anchors.ts')
const v1Removal = resolve(root, 'scripts/check-v1-removal.ts')
const history = resolve(root, 'scripts/check-history-convention.ts')
const v2Governance = resolve(root, 'scripts/check-v2-governance.ts')
const catalogArguments = [
  'check',
  '.',
  '--require-complete-layout',
  '--exclude',
  'backend/falkordb/evidence/artifacts',
  '--exclude',
  'backend/falkordb/benchmark/artifacts',
  ...process.argv.slice(2),
]

const catalogExit = await run(catalog, catalogArguments)
const legacyExit = catalogExit === 0 ? await run(legacy, []) : catalogExit
const v1RemovalExit = legacyExit === 0 ? await run(v1Removal, []) : legacyExit
const historyExit = v1RemovalExit === 0 ? await run(history, []) : v1RemovalExit
process.exitCode = historyExit === 0 ? await run(v2Governance, []) : historyExit

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

import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { resolveNativeToolchain } from './toolchain.mjs'

const root = resolve(import.meta.dirname, '../..')
const toolchain = await resolveNativeToolchain()
const temporary = await mkdtemp(join(tmpdir(), 'codegraph-native-tests-'))
try {
  // Match ttsc's source-plugin workspace: local plugin, installed ttsc and its
  // installed shim modules, with the exact v0.0.0 ttsc replacement it owns.
  const modules = [resolve(root, 'analysis/typescript/native'), toolchain.root,
    ...await shimModules(resolve(toolchain.root, 'shim'))]
  const work = resolve(temporary, 'go.work')
  const quote = (path) => JSON.stringify(path.replaceAll('\\', '/'))
  await writeFile(work, `go 1.26\nuse (\n${modules.map((path) => `\t${quote(path)}`).join('\n')}\n)\nreplace github.com/samchon/ttsc/packages/ttsc v0.0.0 => ${quote(toolchain.root)}\n`)
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name)
    return index < 0 ? fallback : JSON.parse(process.argv[index + 1])
  }
  const files = argument('--files-json', [])
  const options = argument('--options-json', [])
  const code = await new Promise((complete, reject) => {
    const child = spawn(toolchain.go, ['test', ...(files.length ? files : ['./analysis/typescript/native/...']), '-count=1', ...options], {
      cwd: files.length ? resolve(root, 'analysis/typescript/native') : root, stdio: 'inherit', env: { ...process.env, GOTOOLCHAIN: 'local', GOWORK: work },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => signal ? reject(new Error(`Native tests terminated by ${signal}.`)) : complete(code))
  })
  process.exitCode = code ?? 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function shimModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const modules = entries.some((entry) => entry.name === 'go.mod') ? [directory] : []
  for (const entry of entries) {
    if (entry.isDirectory()) modules.push(...await shimModules(join(directory, entry.name)))
  }
  return modules.sort()
}

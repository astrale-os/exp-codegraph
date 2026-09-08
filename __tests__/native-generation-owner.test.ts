import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { it } from 'vitest'

it('releases inaccessible native generations while preserving publication and replay ownership', async () => {
  const require = createRequire(import.meta.url)
  const ttscManifest = require.resolve('ttsc/package.json')
  const ttscRoot = dirname(ttscManifest)
  const ttsc = createRequire(ttscManifest)
  const platform = dirname(ttsc.resolve(`@ttsc/${process.platform}-${process.arch}/package.json`))
  const go = resolve(platform, 'bin/go/bin', process.platform === 'win32' ? 'go.exe' : 'go')
  const scratch = await mkdtemp(join(tmpdir(), 'codegraph-native-owner-'))
  try {
    // Use the same qualified ttsc and shim modules as its source-plugin build.
    // The scratch workspace owns generated sums; tests never alter installed modules.
    const source = resolve(import.meta.dirname, '../analysis/typescript/native')
    const modules = [source, ttscRoot, ...await shimModules(join(ttscRoot, 'shim'))]
    const quote = (path: string) => JSON.stringify(path.replaceAll('\\', '/'))
    const workspace = join(scratch, 'go.work')
    await writeFile(workspace, `go 1.26\n\nuse (\n${modules.map(quote).join('\n')}\n)\n\nreplace github.com/samchon/ttsc/packages/ttsc v0.0.0 => ${quote(ttscRoot)}\n`)
    await promisify(execFile)(go, ['test', '.', '-run', '^TestNativeGenerationOwner', '-count=1'], {
      cwd: source,
      timeout: 90_000,
      env: { ...process.env, GOTOOLCHAIN: 'local', GOWORK: workspace },
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}, 95_000)

async function shimModules(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const modules = entries.some((entry) => entry.isFile() && entry.name === 'go.mod') ? [directory] : []
  for (const entry of entries) {
    if (entry.isDirectory()) modules.push(...await shimModules(join(directory, entry.name)))
  }
  return modules
}

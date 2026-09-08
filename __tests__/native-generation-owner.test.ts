import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, it } from 'vitest'

const run = promisify(execFile)
const source = resolve(import.meta.dirname, '../analysis/typescript/native')
let scratch: string | undefined
let executable: string

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const ttscManifest = require.resolve('ttsc/package.json')
  const ttscRoot = dirname(ttscManifest)
  const ttsc = createRequire(ttscManifest)
  const platform = dirname(ttsc.resolve(`@ttsc/${process.platform}-${process.arch}/package.json`))
  const go = resolve(platform, 'bin/go/bin', process.platform === 'win32' ? 'go.exe' : 'go')
  scratch = await mkdtemp(join(tmpdir(), 'codegraph-native-owner-'))
  executable = join(scratch, process.platform === 'win32' ? 'owner.test.exe' : 'owner.test')
  try {
    // Use the same qualified ttsc and shim modules as its source-plugin build.
    // The scratch workspace owns generated sums; tests never alter installed modules.
    const modules = [source, ttscRoot, ...await shimModules(join(ttscRoot, 'shim'))]
    const quote = (path: string) => JSON.stringify(path.replaceAll('\\', '/'))
    const workspace = join(scratch, 'go.work')
    await writeFile(workspace, `go 1.26\n\nuse (\n${modules.map(quote).join('\n')}\n)\n\nreplace github.com/samchon/ttsc/packages/ttsc v0.0.0 => ${quote(ttscRoot)}\n`)
    // Compiling the TypeScript-Go dependency graph is fixture preparation. A
    // cold compiler cache must not consume the ownership regression's deadline.
    await run(go, ['test', '-c', '-o', executable, '.'], {
      cwd: source,
      timeout: 600_000,
      env: {
        ...process.env,
        GOTOOLCHAIN: 'local', GOWORK: workspace,
        // Share the native-build cache without depending on it being warm.
        GOCACHE: process.env.TTSC_GO_CACHE_DIR
          ? resolve(import.meta.dirname, '..', process.env.TTSC_GO_CACHE_DIR)
          : process.env.GOCACHE || resolve(import.meta.dirname, '../.cache/ttsc/go-build'),
        ...(process.platform === 'linux' ? { CGO_ENABLED: '0' } : {}),
      },
    })
  } catch (error) {
    await rm(scratch, { recursive: true, force: true })
    scratch = undefined
    throw error
  }
}, 605_000)

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true })
})

it('releases inaccessible native generations while preserving publication and replay ownership', async () => {
  await run(executable, ['-test.run=^TestNativeGenerationOwner', '-test.timeout=30s', '-test.count=1'], {
    cwd: source,
    timeout: 35_000,
  })
}, 40_000)

async function shimModules(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const modules = entries.some((entry) => entry.isFile() && entry.name === 'go.mod') ? [directory] : []
  for (const entry of entries) {
    if (entry.isDirectory()) modules.push(...await shimModules(join(directory, entry.name)))
  }
  return modules
}

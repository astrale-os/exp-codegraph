import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import { QUALIFIED_TTSC_VERSION } from '../../analysis/typescript/ttsc/native.ts'
import { readJson } from './shared.mjs'

const execFile = promisify(execFileCallback)

/** Build and regression tests share the installed, qualified compiler toolchain. */
export async function resolveNativeToolchain() {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('ttsc/package.json')
  const root = dirname(manifestPath)
  const ttsc = await readJson(manifestPath)
  if (ttsc.version !== QUALIFIED_TTSC_VERSION) throw new Error(`Expected ttsc ${QUALIFIED_TTSC_VERSION}.`)
  const goSum = await readFile(resolve(root, 'go.sum'), 'utf8')
  const revision = /^github\.com\/microsoft\/typescript-go (v\S+) /mu.exec(goSum)?.[1]
  if (!revision) throw new Error('Cannot determine the TypeScript-Go module revision from ttsc.')
  const platformManifest = createRequire(manifestPath).resolve(`@ttsc/${process.platform}-${process.arch}/package.json`)
  const go = resolve(dirname(platformManifest), 'bin/go/bin', process.platform === 'win32' ? 'go.exe' : 'go')
  const { stdout } = await execFile(go, ['version'])
  const version = /\b(go\d+\.\d+(?:\.\d+)?)\b/u.exec(stdout)?.[1]
  if (!version) throw new Error(`Cannot determine bundled Go version from: ${stdout.trim()}`)
  return { root, go, identity: { ttsc: ttsc.version, typescriptGo: revision, go: version } }
}

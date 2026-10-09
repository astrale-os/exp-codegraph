import { execFile as execFileCallback } from 'node:child_process'
import { copyFile, mkdir, writeFile, chmod } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

import { resolveNativeToolchain } from './toolchain.mjs'
import { buildOxlint } from './build-oxlint.mjs'
import { resolveTtscNativeAnalysis } from '../../analysis/typescript/ttsc/native.ts'
import {
  NATIVE_ARTIFACT_FORMAT,
  NATIVE_BUILD_FORMAT,
  NATIVE_TARGETS,
  PROTOCOL_VERSION,
  digestFile,
  readJson,
  stableJson,
} from './shared.mjs'

const execFile = promisify(execFileCallback)
const root = resolve(import.meta.dirname, '../..')
const target = `${process.platform}-${process.arch}`
const expected = NATIVE_TARGETS[target]
if (!expected) throw new Error(`Codegraph cannot build unsupported native target ${target}.`)

const output = resolve(argument('--output') ?? resolve(root, '.cache/native', target))
const requestedTarget = argument('--target')
if (requestedTarget && requestedTarget !== target) {
  throw new Error(`Native build requested ${requestedTarget} on ${target}; cross-compilation is forbidden.`)
}
const cacheDirectory = resolve(argument('--cache-directory') ?? resolve(root, '.cache/ttsc'))
const packageManifest = await readJson(resolve(root, 'package.json'))
const packageVersion = requiredString(packageManifest.version, 'package version')
// The analyzer is independently useful on every supported host. Only targets
// with a qualified worker build Rust and bind its identity into Go.
const oxlint = expected.oxlint ? await buildOxlint({ root, target, output }) : undefined

const native = await resolveTtscNativeAnalysis({
  root,
  config: 'tsconfig.json',
  cacheDirectory,
  stripDebugInfo: true,
  ...(oxlint ? { ownedOxlint: oxlint.artifact } : {}),
  ...(process.platform === 'linux' ? { environment: { CGO_ENABLED: '0' } } : {}),
})
const executable = resolve(output, expected.executable)
await mkdir(dirname(executable), { recursive: true })
await copyFile(native.command, executable)
await chmod(executable, 0o755)
const digest = await digestFile(executable)
const artifact = {
  target,
  executable: expected.executable,
  ...digest,
  ...(oxlint ? { oxlint: oxlint.artifact } : {}),
}
const toolchain = { ...await readToolchain(), ...(oxlint ? { oxlint: oxlint.toolchain } : {}) }
const source = await sourceIdentity()
const manifest = {
  format: NATIVE_ARTIFACT_FORMAT,
  version: 1,
  packageVersion,
  protocolVersion: PROTOCOL_VERSION,
  artifact,
}
const build = {
  format: NATIVE_BUILD_FORMAT,
  version: 1,
  packageVersion,
  protocolVersion: PROTOCOL_VERSION,
  source,
  toolchain,
  artifact,
}
await writeFile(resolve(output, 'manifest.json'), stableJson(manifest))
await writeFile(resolve(output, 'build.json'), stableJson(build))
process.stdout.write(`${stableJson({ output, build })}`)

async function readToolchain() {
  return (await resolveNativeToolchain()).identity
}

async function sourceIdentity() {
  const revision = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).stdout.trim()
  const status = (await execFile('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' })).stdout
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error(`Invalid source revision ${revision}.`)
  return { revision, dirty: Boolean(status.trim()) }
}

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}.`)
  return value
}

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'

export const NATIVE_RELEASE_FORMAT = 'astrale.codegraph.native-release'
export const NATIVE_ARTIFACT_FORMAT = 'astrale.codegraph.native-artifact'
export const NATIVE_BUILD_FORMAT = 'astrale.codegraph.native-build'
export const PROTOCOL_VERSION = 1

export const NATIVE_TARGETS = Object.freeze({
  'darwin-arm64': Object.freeze({
    package: '@astrale-os/codegraph-native-darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    executable: 'bin/codegraph-native',
  }),
  'darwin-x64': Object.freeze({
    package: '@astrale-os/codegraph-native-darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    executable: 'bin/codegraph-native',
  }),
  'linux-arm64': Object.freeze({
    package: '@astrale-os/codegraph-native-linux-arm64',
    os: 'linux',
    cpu: 'arm64',
    executable: 'bin/codegraph-native',
  }),
  'linux-x64': Object.freeze({
    package: '@astrale-os/codegraph-native-linux-x64',
    os: 'linux',
    cpu: 'x64',
    executable: 'bin/codegraph-native',
  }),
})

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function digestFile(path) {
  const bytes = await readFile(path)
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export async function assertRegularExecutable(path, target) {
  const metadata = await stat(path)
  if (!metadata.isFile()) throw new Error(`${target} artifact is not a regular file: ${path}`)
  if ((metadata.mode & 0o111) === 0) {
    throw new Error(`${target} artifact is not executable: ${path}`)
  }
}

export function assertArtifact(value, target, packageVersion) {
  const expected = NATIVE_TARGETS[target]
  if (!expected) throw new Error(`Unsupported native target ${target}.`)
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.target !== target ||
    value.package !== expected.package ||
    value.executable !== expected.executable ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  ) {
    throw new Error(`${target} has an invalid native artifact record for ${packageVersion}.`)
  }
  return value
}

export function assertArtifactManifest(value, target, packageVersion) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.format !== NATIVE_ARTIFACT_FORMAT ||
    value.version !== 1 ||
    value.packageVersion !== packageVersion ||
    value.protocolVersion !== PROTOCOL_VERSION
  ) {
    throw new Error(`${target} artifact manifest does not match Codegraph ${packageVersion}.`)
  }
  return assertArtifact(value.artifact, target, packageVersion)
}

export function assertToolchain(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !['ttsc', 'typescriptGo', 'go'].every(
      (key) => typeof value[key] === 'string' && Boolean(value[key].trim()),
    )
  ) {
    throw new Error('Native build has no exact compiler toolchain identity.')
  }
  return value
}

export function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

export function within(root, target) {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

export function packageRoot(metaDirectory) {
  const candidate = dirname(dirname(metaDirectory))
  return basename(candidate) === 'dist' ? dirname(candidate) : candidate
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}

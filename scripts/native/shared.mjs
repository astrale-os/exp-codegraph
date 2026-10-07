import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'

export const NATIVE_RELEASE_FORMAT = 'astrale.codegraph.native-release'
export const NATIVE_ARTIFACT_FORMAT = 'astrale.codegraph.native-artifact'
export const NATIVE_BUILD_FORMAT = 'astrale.codegraph.native-build'
export const PROTOCOL_VERSION = 1
export const OXLINT_ENGINE_VERSION = '1.81.0'
export const OXLINT_PROTOCOL_VERSION = 1

export function oxlintExecutable(target) {
  if (!NATIVE_TARGETS[target]) throw new Error(`Unsupported native target ${target}.`)
  return target === 'win32-x64' ? 'bin/codegraph-oxlint.exe' : 'bin/codegraph-oxlint'
}

export function oxlintEligible(target) {
  if (!NATIVE_TARGETS[target]) throw new Error(`Unsupported native target ${target}.`)
  return target !== 'win32-x64'
}

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
  'win32-x64': Object.freeze({
    package: '@astrale-os/codegraph-native-win32-x64',
    os: 'win32',
    cpu: 'x64',
    executable: 'bin/codegraph-native.exe',
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
  if (NATIVE_TARGETS[target]?.os !== 'win32' && (metadata.mode & 0o111) === 0) {
    throw new Error(`${target} artifact is not executable: ${path}`)
  }
}

export function assertArtifact(value, target, packageVersion, { requireOxlint = false } = {}) {
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
  if (value.oxlint !== undefined) assertOxlintArtifact(value.oxlint, target)
  else if (requireOxlint) throw new Error(`${target} has no qualified codegraph-oxlint artifact.`)
  return value
}

export function assertOxlintArtifact(value, target) {
  if (
    !oxlintEligible(target) ||
    !value || typeof value !== 'object' || Array.isArray(value) ||
    value.executable !== oxlintExecutable(target) ||
    !Number.isSafeInteger(value.bytes) || value.bytes < 1 ||
    typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    value.engineVersion !== OXLINT_ENGINE_VERSION ||
    value.protocolVersion !== OXLINT_PROTOCOL_VERSION ||
    !value.source || typeof value.source !== 'object' || Array.isArray(value.source) ||
    typeof value.source.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(value.source.revision) ||
    typeof value.source.patchSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.source.patchSha256)
  ) throw new Error(`${target} has an invalid codegraph-oxlint artifact record.`)
  return value
}

export function assertArtifactManifest(value, target, packageVersion, options) {
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
  return assertArtifact(value.artifact, target, packageVersion, options)
}

export function assertOxlintSources(artifacts) {
  let source
  for (const [target, artifact] of Object.entries(artifacts)) {
    if (!oxlintEligible(target)) {
      if (artifact.oxlint !== undefined) throw new Error(`${target} must not advertise an unqualified codegraph-oxlint runtime.`)
      continue
    }
    const worker = assertOxlintArtifact(artifact.oxlint, target)
    const current = stableJson(worker.source)
    if (source !== undefined && source !== current) {
      throw new Error(`${target} codegraph-oxlint source differs from the release matrix.`)
    }
    source ??= current
  }
}

export function assertToolchain(value, { requireOxlint = false } = {}) {
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
  if (value.oxlint !== undefined) {
    const oxlint = value.oxlint
    if (!oxlint || typeof oxlint !== 'object' || Array.isArray(oxlint) ||
      !['rustc', 'cargo'].every((key) => typeof oxlint[key] === 'string' && Boolean(oxlint[key].trim())) ||
      typeof oxlint.cargoLockSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(oxlint.cargoLockSha256)) {
      throw new Error('Native build has no exact codegraph-oxlint toolchain identity.')
    }
  } else if (requireOxlint) throw new Error('Native build has no codegraph-oxlint toolchain identity.')
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

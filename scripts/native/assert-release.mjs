import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  NATIVE_ARTIFACT_FORMAT,
  NATIVE_RELEASE_FORMAT,
  NATIVE_TARGETS,
  PROTOCOL_VERSION,
  assertArtifact,
  assertArtifactManifest,
  assertRegularExecutable,
  assertToolchain,
  digestFile,
  readJson,
  stableJson,
} from './shared.mjs'

const root = resolve(import.meta.dirname, '../..')
const packageManifest = await readJson(resolve(root, 'package.json'))
const packageVersion = packageManifest.version
const expectedSourceRevision = argument('--source-revision')
const release = await readJson(resolve(root, 'native-release.json'))
if (
  release.format !== NATIVE_RELEASE_FORMAT ||
  release.version !== 1 ||
  release.packageVersion !== packageVersion ||
  release.protocolVersion !== PROTOCOL_VERSION ||
  typeof release.sourceRevision !== 'string' ||
  !/^[a-f0-9]{40}$/u.test(release.sourceRevision)
) {
  throw new Error('Native release manifest is incomplete or does not match the package version.')
}
if (expectedSourceRevision && release.sourceRevision !== expectedSourceRevision) {
  throw new Error(
    `Native release was assembled from ${release.sourceRevision}, expected ${expectedSourceRevision}.`,
  )
}
if (
  packageManifest.private !== true ||
  Object.hasOwn(packageManifest, 'publishConfig') ||
  packageManifest.repository?.url !== 'git+https://github.com/astrale-os/exp-codegraph.git'
) {
  throw new Error('Codegraph must remain a private GitHub artifact package.')
}
assertToolchain(release.toolchain)

const optional = packageManifest.optionalDependencies ?? {}
const targets = Object.keys(NATIVE_TARGETS)
if (Object.keys(release.artifacts ?? {}).sort().join('\0') !== [...targets].sort().join('\0')) {
  throw new Error(`Native release must contain exactly: ${targets.join(', ')}.`)
}
for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
  const artifact = assertArtifact(release.artifacts[target], target, packageVersion)
  const dependency = optional[expected.package]
  if (dependency !== packageVersion && dependency !== `workspace:${packageVersion}` && dependency !== 'workspace:*') {
    throw new Error(`${expected.package} must be an exact-version optional dependency.`)
  }
  const packageRoot = resolve(root, 'native-packages', target)
  const child = await readJson(resolve(packageRoot, 'package.json'))
  if (
    child.name !== expected.package ||
    child.version !== packageVersion ||
    child.private !== true ||
    Object.hasOwn(child, 'publishConfig') ||
    child.repository?.url !== 'git+https://github.com/astrale-os/exp-codegraph.git' ||
    stableJson(child.os) !== stableJson([expected.os]) ||
    stableJson(child.cpu) !== stableJson([expected.cpu]) ||
    child.main !== undefined ||
    child.bin !== undefined ||
    child.scripts !== undefined ||
    child.dependencies !== undefined ||
    child.optionalDependencies !== undefined ||
    child.peerDependencies !== undefined
  ) {
    throw new Error(`${expected.package} is not an opaque exact-target artifact package.`)
  }
  const manifest = await readJson(resolve(packageRoot, 'manifest.json'))
  const packaged = assertArtifactManifest(manifest, target, packageVersion)
  if (manifest.format !== NATIVE_ARTIFACT_FORMAT || stableJson(packaged) !== stableJson(artifact)) {
    throw new Error(`${expected.package} does not match the root release manifest.`)
  }
  const executable = resolve(packageRoot, artifact.executable)
  await assertRegularExecutable(executable, target)
  const digest = await digestFile(executable)
  if (digest.bytes !== artifact.bytes || digest.sha256 !== artifact.sha256) {
    throw new Error(`${expected.package} executable does not match the root release manifest.`)
  }
  await access(resolve(packageRoot, 'LICENSE'))
  await access(resolve(packageRoot, 'THIRD_PARTY_NOTICES.md'))
}

const notices = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
for (const required of ['ttsc', 'TypeScript-Go', 'Go toolchain']) {
  if (!notices.includes(required)) throw new Error(`Third-party notices omit ${required}.`)
}
process.stdout.write(stableJson({ packageVersion, sourceRevision: release.sourceRevision, targets }))

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error(`${name} must be an exact Git revision.`)
  return value
}

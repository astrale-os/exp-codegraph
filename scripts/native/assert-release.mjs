import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  NATIVE_ARTIFACT_DIRECTORY,
  NATIVE_RELEASE_FORMAT,
  NATIVE_TARGETS,
  PROTOCOL_VERSION,
  assertArtifact,
  assertOxlintSources,
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
  packageManifest.private === true ||
  packageManifest.publishConfig?.access !== 'public' ||
  packageManifest.publishConfig?.registry !== 'https://registry.npmjs.org/' ||
  packageManifest.repository?.url !== 'git+https://github.com/astrale-os/exp-codegraph.git'
) {
  throw new Error('Codegraph must select public npm distribution.')
}
if (
  packageManifest.optionalDependencies !== undefined ||
  !packageManifest.files?.includes(NATIVE_ARTIFACT_DIRECTORY)
) {
  throw new Error('Codegraph must deliver its native artifacts inside its one package.')
}
assertToolchain(release.toolchain, { requireOxlint: true })

const targets = Object.keys(NATIVE_TARGETS)
if (Object.keys(release.artifacts ?? {}).sort().join('\0') !== [...targets].sort().join('\0')) {
  throw new Error(`Native release must contain exactly: ${targets.join(', ')}.`)
}
assertOxlintSources(release.artifacts)
for (const target of targets) {
  const artifact = assertArtifact(release.artifacts[target], target, packageVersion, { requireOxlint: true })
  const artifactRoot = resolve(root, NATIVE_ARTIFACT_DIRECTORY, target)
  for (const delivered of [artifact, artifact.oxlint]) {
    // pnpm pack marks only bin entries and these declared files as executable.
    const packed = `./${NATIVE_ARTIFACT_DIRECTORY}/${target}/${delivered.executable}`
    if (!packageManifest.publishConfig.executableFiles?.includes(packed)) {
      throw new Error(`${packed} is not declared in publishConfig.executableFiles.`)
    }
    const executable = resolve(artifactRoot, delivered.executable)
    await assertRegularExecutable(executable, target)
    const digest = await digestFile(executable)
    if (digest.bytes !== delivered.bytes || digest.sha256 !== delivered.sha256) {
      throw new Error(`${target} ${delivered.executable} does not match the release manifest.`)
    }
  }
}

const notices = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
for (const required of ['ttsc', 'TypeScript-Go', 'Go toolchain', 'Oxlint']) {
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

import { chmod, copyFile, lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  NATIVE_ARTIFACT_DIRECTORY,
  NATIVE_BUILD_FORMAT,
  NATIVE_RELEASE_FORMAT,
  NATIVE_TARGETS,
  PROTOCOL_VERSION,
  assertArtifactManifest,
  assertOxlintSources,
  assertRegularExecutable,
  assertToolchain,
  digestFile,
  readJson,
  stableJson,
} from './shared.mjs'

const root = resolve(import.meta.dirname, '../..')
const input = resolve(argument('--input') ?? resolve(root, '.native-input'))
const packageManifestPath = resolve(root, 'package.json')
const packageManifest = await readJson(packageManifestPath)
const packageVersion = packageManifest.version
if (typeof packageVersion !== 'string' || !packageVersion.trim()) {
  throw new Error('Codegraph package version is missing.')
}

const artifacts = {}
let releaseToolchain
let releaseOxlintToolchain
let sourceRevision
for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
  const sourceRoot = resolve(input, target)
  const build = await readJson(resolve(sourceRoot, 'build.json'))
  if (
    build.format !== NATIVE_BUILD_FORMAT ||
    build.version !== 1 ||
    build.packageVersion !== packageVersion ||
    build.protocolVersion !== PROTOCOL_VERSION ||
    !build.source ||
    typeof build.source !== 'object' ||
    build.source.dirty !== false ||
    typeof build.source.revision !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(build.source.revision)
  ) {
    throw new Error(`${target} build provenance is invalid or dirty.`)
  }
  const { oxlint: workerToolchain, ...toolchain } = assertToolchain(build.toolchain, { requireOxlint: expected.oxlint })
  if (releaseToolchain && stableJson(releaseToolchain) !== stableJson(toolchain)) {
    throw new Error(`${target} compiler toolchain differs from the release matrix.`)
  }
  if (sourceRevision && sourceRevision !== build.source.revision) {
    throw new Error(`${target} was built from ${build.source.revision}, expected ${sourceRevision}.`)
  }
  releaseToolchain ??= toolchain
  if (workerToolchain && releaseOxlintToolchain && stableJson(releaseOxlintToolchain) !== stableJson(workerToolchain)) {
    throw new Error(`${target} Oxlint toolchain differs from the release matrix.`)
  }
  if (workerToolchain) releaseOxlintToolchain ??= workerToolchain
  sourceRevision ??= build.source.revision

  const sourceManifest = await readJson(resolve(sourceRoot, 'manifest.json'))
  const artifact = assertArtifactManifest(sourceManifest, target, packageVersion, { requireOxlint: expected.oxlint })
  if (stableJson(artifact) !== stableJson(build.artifact)) {
    throw new Error(`${target} build and artifact manifests disagree.`)
  }
  const artifactRoot = resolve(root, NATIVE_ARTIFACT_DIRECTORY, target)
  await stageExecutable(
    resolve(sourceRoot, artifact.executable),
    resolve(artifactRoot, expected.executable),
    artifact,
    target,
  )
  if (artifact.oxlint) await stageExecutable(
    resolve(sourceRoot, artifact.oxlint.executable),
    resolve(artifactRoot, artifact.oxlint.executable),
    artifact.oxlint,
    target,
  )
  artifacts[target] = artifact
}

assertOxlintSources(artifacts)
await writeFile(
  resolve(root, 'native-release.json'),
  stableJson({
    format: NATIVE_RELEASE_FORMAT,
    version: 1,
    packageVersion,
    protocolVersion: PROTOCOL_VERSION,
    sourceRevision,
    toolchain: { ...releaseToolchain, oxlint: releaseOxlintToolchain },
    artifacts,
  }),
)
process.stdout.write(
  stableJson({ packageVersion, sourceRevision, targets: Object.keys(artifacts).sort() }),
)

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

// GitHub artifact transport keeps content, but not executable mode. Authenticate
// downloaded bytes first and normalize only the owned package staging copy.
async function stageExecutable(source, destination, artifact, target) {
  if (!(await lstat(source)).isFile()) {
    throw new Error(`${target} downloaded artifact is not a regular file: ${source}`)
  }
  const digest = await digestFile(source)
  if (digest.bytes !== artifact.bytes || digest.sha256 !== artifact.sha256) {
    throw new Error(`${target} ${artifact.executable} bytes differ from its build manifest.`)
  }
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  await chmod(destination, 0o755)
  await assertRegularExecutable(destination, target)
  const staged = await digestFile(destination)
  if (staged.bytes !== artifact.bytes || staged.sha256 !== artifact.sha256) {
    throw new Error(`${target} staged ${artifact.executable} bytes differ from its build manifest.`)
  }
}

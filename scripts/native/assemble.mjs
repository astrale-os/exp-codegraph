import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  NATIVE_ARTIFACT_FORMAT,
  NATIVE_BUILD_FORMAT,
  NATIVE_RELEASE_FORMAT,
  NATIVE_TARGETS,
  PROTOCOL_VERSION,
  assertArtifactManifest,
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
  const toolchain = assertToolchain(build.toolchain)
  if (releaseToolchain && stableJson(releaseToolchain) !== stableJson(toolchain)) {
    throw new Error(`${target} compiler toolchain differs from the release matrix.`)
  }
  if (sourceRevision && sourceRevision !== build.source.revision) {
    throw new Error(`${target} was built from ${build.source.revision}, expected ${sourceRevision}.`)
  }
  releaseToolchain ??= toolchain
  sourceRevision ??= build.source.revision

  const sourceManifest = await readJson(resolve(sourceRoot, 'manifest.json'))
  const artifact = assertArtifactManifest(sourceManifest, target, packageVersion)
  if (stableJson(artifact) !== stableJson(build.artifact)) {
    throw new Error(`${target} build and package manifests disagree.`)
  }
  const sourceExecutable = resolve(sourceRoot, artifact.executable)
  await chmod(sourceExecutable, 0o755)
  await assertRegularExecutable(sourceExecutable, target)
  const digest = await digestFile(sourceExecutable)
  if (digest.bytes !== artifact.bytes || digest.sha256 !== artifact.sha256) {
    throw new Error(`${target} artifact bytes differ from its build manifest.`)
  }

  const packageRoot = resolve(root, 'native-packages', target)
  const destination = resolve(packageRoot, expected.executable)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(sourceExecutable, destination)
  await copyFile(resolve(root, 'LICENSE'), resolve(packageRoot, 'LICENSE'))
  await copyFile(
    resolve(root, 'THIRD_PARTY_NOTICES.md'),
    resolve(packageRoot, 'THIRD_PARTY_NOTICES.md'),
  )
  await writeFile(
    resolve(packageRoot, 'manifest.json'),
    stableJson({
      format: NATIVE_ARTIFACT_FORMAT,
      version: 1,
      packageVersion,
      protocolVersion: PROTOCOL_VERSION,
      artifact,
    }),
  )
  const child = await readJson(resolve(packageRoot, 'package.json'))
  child.version = packageVersion
  await writeFile(resolve(packageRoot, 'package.json'), stableJson(child))
  artifacts[target] = artifact
}

await writeFile(
  resolve(root, 'native-release.json'),
  stableJson({
    format: NATIVE_RELEASE_FORMAT,
    version: 1,
    packageVersion,
    protocolVersion: PROTOCOL_VERSION,
    sourceRevision,
    toolchain: releaseToolchain,
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

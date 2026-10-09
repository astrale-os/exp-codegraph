import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { assertDeliveredArtifact } from './compression.mjs'

import {
  nativeReleaseAssetName,
  NATIVE_RELEASE_FORMAT,
  NATIVE_TARGETS,
  PROTOCOL_VERSION,
  assertArtifact,
  assertOxlintSources,
  assertToolchain,
  readJson,
  stableJson,
} from './shared.mjs'

const root = resolve(import.meta.dirname, '../..')
const packageManifest = await readJson(resolve(root, 'package.json'))
const packageVersion = packageManifest.version
const expectedSourceRevision = argument('--source-revision')
const release = await readJson(resolve(root, 'native-release.json'))
const assets = resolve(argument('--assets-dir') ?? resolve(root, '.native-release-assets'))
if (
  release.format !== NATIVE_RELEASE_FORMAT ||
  release.version !== 1 ||
  release.delivery !== 'github-release' ||
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
  packageManifest.files?.includes('native-artifacts')
) {
  throw new Error('Codegraph must carry only native release metadata in its one npm package.')
}
assertToolchain(release.toolchain, { requireOxlint: true })

const targets = Object.keys(NATIVE_TARGETS)
if (Object.keys(release.artifacts ?? {}).sort().join('\0') !== [...targets].sort().join('\0')) {
  throw new Error(`Native release must contain exactly: ${targets.join(', ')}.`)
}
assertOxlintSources(release.artifacts)
const expectedAssets = ['native-release.json']
for (const target of targets) {
  const artifact = assertArtifact(release.artifacts[target], target, packageVersion, { requireOxlint: NATIVE_TARGETS[target].oxlint, delivery: release.delivery, sourceRevision: release.sourceRevision })
  for (const delivered of [artifact, ...(artifact.oxlint ? [artifact.oxlint] : [])]) {
    const name = nativeReleaseAssetName(target, delivered.executable === 'bin/codegraph-oxlint' ? 'oxlint' : 'native', release.sourceRevision)
    if (!delivered.compression || delivered.compression.path !== name) {
      throw new Error(`${target} native asset is not bound to the exact release source.`)
    }
    if (!(await lstat(resolve(assets, name))).isFile()) throw new Error(`${target} release asset is not a regular file.`)
    expectedAssets.push(name)
    await assertDeliveredArtifact(resolve(assets, name), delivered)
  }
}

if (stableJson(await readJson(resolve(assets, 'native-release.json'))) !== stableJson(release)) throw new Error('External native header differs from npm metadata.')
if ((await readdir(assets)).sort().join('\0') !== expectedAssets.sort().join('\0')) throw new Error('External native assets contain unexpected or missing files.')

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
  if (name === '--source-revision' && !/^[a-f0-9]{40}$/u.test(value)) throw new Error(`${name} must be an exact Git revision.`)
  return value
}

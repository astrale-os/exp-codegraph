import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

import {
  NATIVE_ARTIFACT_DIRECTORY, NATIVE_RELEASE_FORMAT, NATIVE_TARGETS, PROTOCOL_VERSION,
  assertArtifact, assertOxlintSources, assertToolchain, stableJson,
} from './shared.mjs'

const execFile = promisify(execFileCallback)
const npmRegistry = 'https://registry.npmjs.org/'
const packageName = '@astrale-os/codegraph'
const repositoryUrl = 'git+https://github.com/astrale-os/exp-codegraph.git'
const maximumArchiveBytes = 256 * 1024 * 1024

export function admitQualificationRun(run, sourceRevision, repository) {
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u)
  assert.equal(run.repository?.full_name, repository, 'Qualification repository differs.')
  assert.equal(run.head_repository?.full_name, repository, 'Qualification ran from a fork.')
  assert.equal(run.head_sha, sourceRevision, 'Qualification source revision differs.')
  assert.equal(run.head_branch, 'main', 'Publication requires a main qualification.')
  assert.equal(run.path, '.github/workflows/native-release.yml', 'Wrong qualification workflow.')
  assert(['push', 'workflow_dispatch'].includes(run.event), 'PR artifacts cannot be published.')
  assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'success', 'Native qualification did not succeed.')
}

/** Admit existing qualified bytes; never build, rewrite, repack or publish them. */
export async function admitReleasePackage(directory, sourceRevision, version) {
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u)
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  const files = (await readdir(directory)).filter((name) => name.endsWith('.tgz'))
  assert.deepEqual(files, [archiveName(packageName, version)], 'Release must contain exactly the Codegraph archive.')
  const archive = resolve(directory, files[0])
  assert((await stat(archive)).size <= maximumArchiveBytes, 'Archive exceeds the release admission bound.')
  const manifest = await archiveJson(archive, 'package.json')
  assertPublicManifest(manifest, packageName, version)
  assert.equal(manifest.optionalDependencies, undefined, 'Release must remain one package.')
  assert.equal(manifest.dependencies?.ttsc, undefined)
  const release = await archiveJson(archive, 'native-release.json')
  assertNativeRelease(release, sourceRevision, version)
  for (const member of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert((await archiveMember(archive, member)).length > 0, 'Release license notices are empty.')
  }
  let viewer, headers
  if (release.delivery === 'github-release') {
    viewer = await archiveJson(archive, 'viewer-release.json')
    await assertViewerRelease(viewer, version, sourceRevision)
    const members = await archiveMembers(archive, '')
    assert.deepEqual(members.filter((name) => /^(?:native-artifacts|dist\/viewer|\.native-release-assets|\.viewer-release-assets)(?:\/|$)/u.test(name)), [],
      'Light package must not embed release payloads.')
    headers = Object.fromEntries(await Promise.all([
      ['native', 'native-release.json'], ['viewer', 'viewer-release.json'],
    ].map(async ([key, member]) => [key, identity(await archiveMember(archive, member))])))
  } else {
    const delivered = []
    for (const target of Object.keys(NATIVE_TARGETS)) {
      const artifact = release.artifacts[target]
      for (const executable of [artifact, ...(artifact.oxlint ? [artifact.oxlint] : [])]) {
        const member = `${NATIVE_ARTIFACT_DIRECTORY}/${target}/${executable.compression?.path ?? executable.executable}`
        admitEncoded(await archiveMember(archive, member), executable, member)
        delivered.push(member)
      }
    }
    assert.deepEqual(await archiveMembers(archive, NATIVE_ARTIFACT_DIRECTORY), delivered.sort(),
      'Archive must deliver exactly the qualified native payloads.')
  }
  const bytes = await readFile(archive)
  return { sourceRevision, version, native: release, ...(viewer ? { viewer, headers } : {}), tarballs: { '.': archive }, package: {
    name: packageName, version, archive, bytes: bytes.length, sha256: hash(bytes, 'sha256'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  } }
}

/** Admit precisely the external assets selected by the already admitted package. */
export async function admitExternalReleaseAssets({ directory, sourceRevision, packageVersion, native, viewer, headers }) {
  const assets = await releaseAssets({ sourceRevision, packageVersion, native, viewer, headers })
  assert.deepEqual((await readdir(directory)).sort(), assets.map((asset) => asset.name).sort(),
    'External release must contain exactly its ten qualified files.')
  const admitted = []
  for (const asset of assets) {
    const path = resolve(directory, asset.name)
    const metadata = await lstat(path)
    assert(metadata.isFile(), `${asset.name} is not a regular file.`)
    assert.equal(metadata.size, asset.bytes, `${asset.name} encoded size differs.`)
    await admitAsset(await readFile(path), asset)
    admitted.push({ name: asset.name, path, bytes: asset.bytes, sha256: asset.sha256 })
  }
  return admitted
}

/** Anonymous public delivery is qualified separately from npm and GitHub API credentials. */
export async function admitPublishedReleaseAssets(admitted, { fetcher = fetch, signal } = {}) {
  const assets = await releaseAssets({ sourceRevision: admitted.sourceRevision,
    packageVersion: admitted.version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })
  const receipt = []
  for (const asset of assets) {
    signal?.throwIfAborted()
    const url = `https://github.com/astrale-os/exp-codegraph/releases/download/codegraph-v${admitted.version}-${admitted.sourceRevision}/${asset.name}`
    const deadline = AbortSignal.timeout(120_000)
    const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline })
    assert(response.ok && response.body, `Cannot verify public release ${asset.name}: HTTP ${response.status}.`)
    if (response.url) assert.equal(new URL(response.url).protocol, 'https:', 'Release download redirected outside HTTPS.')
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      signal?.throwIfAborted()
      bytes += chunk.byteLength
      assert(bytes <= asset.bytes, `${asset.name} exceeds its encoded size.`)
      chunks.push(Buffer.from(chunk))
    }
    await admitAsset(Buffer.concat(chunks, bytes), asset)
    receipt.push({ name: asset.name, url, bytes: asset.bytes, sha256: asset.sha256 })
  }
  return receipt
}

async function releaseAssets({ sourceRevision, packageVersion, native, viewer, headers }) {
  assertNativeRelease(native, sourceRevision, packageVersion)
  assert.equal(native.delivery, 'github-release', 'External delivery requires a light package.')
  await assertViewerRelease(viewer, packageVersion, sourceRevision)
  const assets = Object.values(native.artifacts).flatMap((artifact) => [artifact, ...(artifact.oxlint ? [artifact.oxlint] : [])])
    .map((artifact) => ({ name: artifact.compression.path, bytes: artifact.compression.bytes, sha256: artifact.compression.sha256, original: artifact }))
  assets.push({ name: viewer.asset, bytes: viewer.compression.bytes, sha256: viewer.compression.sha256, original: viewer, viewer: true })
  for (const [name, value, key, serialized] of [
    ['native-release.json', native, 'native', stableJson(native)],
    ['viewer-release.json', viewer, 'viewer', JSON.stringify(viewer, null, 2) + '\n'],
  ]) {
    const expected = headers?.[key] ?? identity(Buffer.from(serialized))
    assets.push({ name, bytes: expected.bytes, sha256: expected.sha256, header: value })
  }
  assert.equal(assets.length, 10)
  assert.equal(new Set(assets.map((asset) => asset.name)).size, 10)
  for (const asset of assets) {
    assert.match(asset.name, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u)
    assert(Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= maximumArchiveBytes, 'Asset exceeds the release admission bound.')
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u)
  }
  return assets.sort((left, right) => left.name.localeCompare(right.name))
}

function assertNativeRelease(release, sourceRevision, version) {
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u)
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  assert.equal(release.format, NATIVE_RELEASE_FORMAT)
  assert.equal(release.version, 1)
  assert.equal(release.packageVersion, version)
  assert.equal(release.protocolVersion, PROTOCOL_VERSION)
  assert.equal(release.sourceRevision, sourceRevision, 'Archive source revision differs.')
  assert(release.delivery === undefined || release.delivery === 'github-release', 'Unsupported release delivery.')
  assertToolchain(release.toolchain, { requireOxlint: true })
  assert.deepEqual(Object.keys(release.artifacts).sort(), Object.keys(NATIVE_TARGETS).sort())
  assertOxlintSources(release.artifacts)
  for (const target of Object.keys(NATIVE_TARGETS)) assertArtifact(release.artifacts[target], target, version, {
    requireOxlint: NATIVE_TARGETS[target].oxlint, delivery: release.delivery, sourceRevision,
  })
}

async function assertViewerRelease(viewer, version, sourceRevision) {
  const { admitViewerRelease } = await import('../../server/viewer-release.ts')
  admitViewerRelease(viewer, version, sourceRevision)
}

function admitEncoded(encoded, original, name) {
  const expected = original.compression ?? original
  assert.equal(encoded.length, expected.bytes, `${name} encoded size differs.`)
  assert.equal(hash(encoded, 'sha256'), expected.sha256, `${name} encoded digest differs.`)
  assert(original.bytes <= maximumArchiveBytes, `${name} exceeds its decoded bound.`)
  const decoded = original.compression ? gunzipSync(encoded, { maxOutputLength: original.bytes }) : encoded
  assert.equal(decoded.length, original.bytes, `${name} decoded size differs.`)
  assert.equal(hash(decoded, 'sha256'), original.sha256, `${name} decoded digest differs.`)
  return decoded
}

async function admitAsset(bytes, asset) {
  if (asset.header) {
    assert.deepEqual(identity(bytes), { bytes: asset.bytes, sha256: asset.sha256 }, `${asset.name} encoded identity differs.`)
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), asset.header, `${asset.name} differs from its package header.`)
  } else {
    const decoded = admitEncoded(bytes, asset.original, asset.name)
    if (asset.viewer) {
      const { openViewerArchive } = await import('../../server/viewer-archive.ts')
      const temporary = await mkdtemp(join(tmpdir(), 'codegraph-viewer-admission-'))
      try {
        const path = join(temporary, 'viewer.tar')
        await writeFile(path, decoded, { flag: 'wx' })
        const archive = await openViewerArchive(path, asset.original)
        try {
          const chunks = []
          for await (const chunk of archive.stream('viewer-build.json')) chunks.push(Buffer.from(chunk))
          const build = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          assert.equal(build.format, 'codegraph.viewer-build.v1', 'Viewer build license inventory format differs.')
          assert(Array.isArray(build.packages), 'Viewer build license inventory is missing.')
          for (const dependency of build.packages) {
            assert(typeof dependency.name === 'string' && dependency.name.length > 0)
            assert(typeof dependency.version === 'string' && dependency.version.length > 0)
            assert(Array.isArray(dependency.notices) && dependency.notices.length > 0, 'Bundled dependency has no license notices.')
            for (const notice of dependency.notices) {
              assert(typeof notice.file === 'string' && notice.file.length > 0)
              assert.match(notice.sha256, /^[a-f0-9]{64}$/u)
            }
          }
        } finally { await archive.close() }
      } finally { await rm(temporary, { recursive: true, force: true }) }
    }
  }
}

function identity(bytes) { return { bytes: bytes.length, sha256: hash(bytes, 'sha256') } }

/** An existing immutable version must match before the publisher can resume. */
export async function admitRegistryVersion(unit, { allowMissing, fetcher = fetch }) {
  const response = await fetcher(`${npmRegistry}${encodeURIComponent(unit.name)}/${unit.version}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (allowMissing && response.status === 404) return
  assert(response.ok, `Cannot verify npm ${unit.name}@${unit.version}: HTTP ${response.status}.`)
  const published = await response.json()
  assert.equal(published.name, unit.name)
  assert.equal(published.version, unit.version)
  assert.equal(published.dist?.integrity, unit.integrity, `npm ${unit.name}@${unit.version} has different immutable bytes.`)
  assert.equal(new URL(published.dist.tarball).origin, new URL(npmRegistry).origin)
}

function assertPublicManifest(manifest, name, version) {
  assert.equal(manifest.name, name)
  assert.equal(manifest.version, version)
  assert.notEqual(manifest.private, true, `${name} is private.`)
  assert.equal(manifest.publishConfig?.access, 'public')
  assert.equal(manifest.publishConfig?.registry, npmRegistry)
  assert.equal(manifest.repository?.url, repositoryUrl)
}

function archiveName(name, version) { return `${name.replace('@', '').replace('/', '-')}-${version}.tgz` }
function hash(bytes, algorithm) { return createHash(algorithm).update(bytes).digest('hex') }
async function archiveJson(archive, member) { return JSON.parse((await archiveMember(archive, member)).toString('utf8')) }
async function archiveMember(archive, member) {
  return (await execFile('tar', ['-xOf', archive, `package/${member}`], {
    encoding: 'buffer', maxBuffer: maximumArchiveBytes,
  })).stdout
}
async function archiveMembers(archive, directory) {
  const { stdout } = await execFile('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const prefix = directory ? `package/${directory}/` : 'package/'
  return stdout.split('\n').filter((member) => member.startsWith(prefix) && (!directory || !member.endsWith('/')))
    .map((member) => member.slice('package/'.length)).sort()
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const argument = (name) => {
    const index = process.argv.indexOf(name)
    if (index < 0) return undefined
    const value = process.argv[index + 1]
    assert(value && !value.startsWith('--'), `${name} requires a value.`)
    return value
  }
  const sourceRevision = argument('--source-revision')
  const directory = argument('--directory')
  assert(directory && sourceRevision, '--directory and --source-revision are required.')
  const root = resolve(import.meta.dirname, '../..')
  const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version
  const runPath = argument('--qualification-run')
  if (runPath) admitQualificationRun(
    JSON.parse(await readFile(runPath, 'utf8')), sourceRevision, process.env.GITHUB_REPOSITORY,
  )
  const admitted = await admitReleasePackage(resolve(directory), sourceRevision, version)
  const assetsDirectory = argument('--assets-directory')
  if (assetsDirectory) admitted.assets = await admitExternalReleaseAssets({ directory: resolve(assetsDirectory),
    sourceRevision, packageVersion: version, native: admitted.native, viewer: admitted.viewer, headers: admitted.headers })
  if (process.argv.includes('--remote-assets')) admitted.remoteAssets = await admitPublishedReleaseAssets(admitted)
  if (process.argv.includes('--npm-preflight')) await admitRegistryVersion(admitted.package, { allowMissing: true })
  if (process.argv.includes('--npm-published')) await admitRegistryVersion(admitted.package, { allowMissing: false })
  const output = argument('--github-output')
  if (output) await appendFile(output, `tarballs-json=${JSON.stringify(admitted.tarballs)}\nversion=${version}\n`)
  process.stdout.write(stableJson(admitted))
}

export function assertNpmConsumerLock(lock) {
  assert.doesNotMatch(lock, /(?:^|[\s'",[{])(?:file:|workspace:|link:|portal:|patch:|git:|git\+|overrides:|patchedDependencies:)/mu)
  assert.doesNotMatch(lock, /github\.com|npm\.pkg\.github\.com|_authToken|NODE_AUTH_TOKEN|NPM_TOKEN/iu)
  for (const [url] of lock.matchAll(/https?:\/\/[^\s'",}\]]+/gu)) {
    assert.equal(new URL(url).origin, new URL(npmRegistry).origin, 'Consumer contains a non-npm dependency.')
  }
}

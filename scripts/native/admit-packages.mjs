import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  assert.equal(manifest.optionalDependencies, undefined, 'Native artifacts must travel inside the package.')
  assert.equal(manifest.dependencies?.ttsc, undefined)
  const release = await archiveJson(archive, 'native-release.json')
  assert.equal(release.format, NATIVE_RELEASE_FORMAT)
  assert.equal(release.version, 1)
  assert.equal(release.packageVersion, version)
  assert.equal(release.protocolVersion, PROTOCOL_VERSION)
  assert.equal(release.sourceRevision, sourceRevision, 'Archive source revision differs.')
  assertToolchain(release.toolchain, { requireOxlint: true })
  assert.deepEqual(Object.keys(release.artifacts).sort(), Object.keys(NATIVE_TARGETS).sort())
  assertOxlintSources(release.artifacts)
  for (const member of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert((await archiveMember(archive, member)).length > 0, 'Release license notices are empty.')
  }
  const delivered = []
  for (const target of Object.keys(NATIVE_TARGETS)) {
    const artifact = assertArtifact(release.artifacts[target], target, version, { requireOxlint: NATIVE_TARGETS[target].oxlint })
    for (const executable of [artifact, ...(artifact.oxlint ? [artifact.oxlint] : [])]) {
      const member = `${NATIVE_ARTIFACT_DIRECTORY}/${target}/${executable.compression?.path ?? executable.executable}`
      const deliveredBytes = await archiveMember(archive, member)
      const encoded = executable.compression ?? executable
      assert.equal(deliveredBytes.length, encoded.bytes, `${member} encoded size differs.`)
      assert.equal(hash(deliveredBytes, 'sha256'), encoded.sha256, `${member} encoded digest differs.`)
      const bytes = executable.compression ? gunzipSync(deliveredBytes, { maxOutputLength: executable.bytes }) : deliveredBytes
      assert.equal(bytes.length, executable.bytes, `${member} size differs.`)
      assert.equal(hash(bytes, 'sha256'), executable.sha256, `${member} digest differs.`)
      delivered.push(member)
    }
  }
  assert.deepEqual(await archiveMembers(archive, NATIVE_ARTIFACT_DIRECTORY), delivered.sort(),
    'Archive must deliver exactly the qualified native payloads.')
  const bytes = await readFile(archive)
  return { sourceRevision, version, tarballs: { '.': archive }, package: {
    name: packageName, version, archive, bytes: bytes.length, sha256: hash(bytes, 'sha256'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  } }
}

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
  const prefix = `package/${directory}/`
  return stdout.split('\n').filter((member) => member.startsWith(prefix) && !member.endsWith('/'))
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

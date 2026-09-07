import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  NATIVE_RELEASE_FORMAT, NATIVE_TARGETS, PROTOCOL_VERSION,
  assertArtifactManifest, assertToolchain, stableJson,
} from './shared.mjs'

const execFile = promisify(execFileCallback)
const npmRegistry = 'https://registry.npmjs.org/'
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
export async function admitReleasePackages(directory, sourceRevision, version) {
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u)
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  const units = [
    ...Object.entries(NATIVE_TARGETS).map(([target, artifact]) => ({
      directory: `native-packages/${target}`, name: artifact.package, target,
    })),
    { directory: '.', name: '@astrale-os/codegraph' },
  ]
  const expectedFiles = units.map(({ name }) => archiveName(name, version)).sort()
  const files = (await readdir(directory)).filter((name) => name.endsWith('.tgz')).sort()
  assert.deepEqual(files, expectedFiles, 'Release must contain exactly the six expected archives.')
  const rootArchive = resolve(directory, archiveName('@astrale-os/codegraph', version))
  const release = await archiveJson(rootArchive, 'native-release.json')
  assert.equal(release.format, NATIVE_RELEASE_FORMAT)
  assert.equal(release.version, 1)
  assert.equal(release.packageVersion, version)
  assert.equal(release.protocolVersion, PROTOCOL_VERSION)
  assert.equal(release.sourceRevision, sourceRevision, 'Archive source revision differs.')
  assertToolchain(release.toolchain)
  assert.deepEqual(Object.keys(release.artifacts).sort(), Object.keys(NATIVE_TARGETS).sort())
  const packages = []
  for (const unit of units) {
    const archive = resolve(directory, archiveName(unit.name, version))
    const manifest = await archiveJson(archive, 'package.json')
    assertPublicManifest(manifest, unit.name, version)
    if (unit.target) {
      const expected = NATIVE_TARGETS[unit.target]
      assert.deepEqual(manifest.os, [expected.os])
      assert.deepEqual(manifest.cpu, [expected.cpu])
      const artifact = assertArtifactManifest(await archiveJson(archive, 'manifest.json'), unit.target, version)
      assert.equal(stableJson(artifact), stableJson(release.artifacts[unit.target]))
      const binary = await archiveMember(archive, expected.executable)
      assert.equal(binary.length, artifact.bytes, `${unit.name} executable size differs.`)
      assert.equal(hash(binary, 'sha256'), artifact.sha256, `${unit.name} executable digest differs.`)
    } else {
      assert.deepEqual(manifest.optionalDependencies, Object.fromEntries(
        Object.values(NATIVE_TARGETS).map(({ package: name }) => [name, version]),
      ), 'Packed native dependencies must be exact registry versions.')
      assert.equal(manifest.dependencies?.ttsc, undefined)
    }
    assert((await stat(archive)).size <= maximumArchiveBytes, 'Archive exceeds the release admission bound.')
    const bytes = await readFile(archive)
    packages.push({
      ...unit, version, archive, bytes: bytes.length, sha256: hash(bytes, 'sha256'),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    })
  }
  return { sourceRevision, version, packages, tarballs: Object.fromEntries(
    packages.map((unit) => [unit.directory, unit.archive]),
  ) }
}

/** Existing immutable versions must match before an ordered publisher can resume. */
export async function admitRegistryVersions(packages, { allowMissing, fetcher = fetch }) {
  for (const unit of packages) {
    const response = await fetcher(`${npmRegistry}${encodeURIComponent(unit.name)}/${unit.version}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (allowMissing && response.status === 404) continue
    assert(response.ok, `Cannot verify npm ${unit.name}@${unit.version}: HTTP ${response.status}.`)
    const published = await response.json()
    assert.equal(published.name, unit.name)
    assert.equal(published.version, unit.version)
    assert.equal(published.dist?.integrity, unit.integrity, `npm ${unit.name}@${unit.version} has different immutable bytes.`)
    assert.equal(new URL(published.dist.tarball).origin, new URL(npmRegistry).origin)
  }
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
  const admitted = await admitReleasePackages(resolve(directory), sourceRevision, version)
  if (process.argv.includes('--npm-preflight')) await admitRegistryVersions(admitted.packages, { allowMissing: true })
  if (process.argv.includes('--npm-published')) await admitRegistryVersions(admitted.packages, { allowMissing: false })
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

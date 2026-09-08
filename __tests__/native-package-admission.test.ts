import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import {
  admitQualificationRun, admitRegistryVersions, admitReleasePackages, assertNpmConsumerLock,
} from '../scripts/native/admit-packages.mjs'
import { NATIVE_TARGETS } from '../scripts/native/shared.mjs'

const execFile = promisify(execFileCallback)
const temporary: string[] = []
const version = '0.1.0'
const revision = '1'.repeat(40)
const repository = 'astrale-os/exp-codegraph'
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('qualified release archive admission', () => {
  it('binds six real archives and native executable bytes to the qualified source', async () => {
    const directory = await releaseFixture()
    const release = await admitReleasePackages(directory, revision, version)
    expect(release.packages).toHaveLength(6)
    expect(release.packages.at(-1)?.name).toBe('@astrale-os/codegraph')
    expect(Object.keys(release.tarballs)).toEqual([...Object.keys(NATIVE_TARGETS).map((target) => `native-packages/${target}`), '.'])
    expect(release.packages.every((unit: { integrity: string }) => unit.integrity.startsWith('sha512-'))).toBe(true)
    await expect(admitReleasePackages(directory, '2'.repeat(40), version)).rejects.toThrow('source revision')
  })

  it.each(['binary', 'dependency', 'version'] as const)('rejects a torn %s publication cohort before publishing', async (corruption) => {
    await expect(admitReleasePackages(await releaseFixture(corruption), revision, version)).rejects.toThrow()
  })

  it('requires successful main qualification from the exact workflow, repository and revision', () => {
    const run = {
      repository: { full_name: repository }, head_repository: { full_name: repository },
      head_sha: revision, head_branch: 'main', path: '.github/workflows/native-release.yml',
      event: 'push', status: 'completed', conclusion: 'success',
    }
    expect(() => admitQualificationRun(run, revision, repository)).not.toThrow()
    for (const changed of [
      { event: 'pull_request' }, { conclusion: 'failure' }, { head_sha: '2'.repeat(40) },
      { head_repository: { full_name: 'other/fork' } }, { path: '.github/workflows/ci.yml' },
    ]) expect(() => admitQualificationRun({ ...run, ...changed }, revision, repository)).toThrow()
  })

  it('resumes only byte-identical npm versions and keeps missing versions explicit', async () => {
    const units = [{ name: '@astrale-os/codegraph', version, integrity: 'sha512-qualified' }]
    const metadata = (integrity: string) => new Response(JSON.stringify({
      name: units[0]!.name, version, dist: {
        integrity, tarball: 'https://registry.npmjs.org/@astrale-os/codegraph/-/codegraph-0.1.0.tgz',
      },
    }))
    await expect(admitRegistryVersions(units, { allowMissing: true, fetcher: async () => new Response('', { status: 404 }) })).resolves.toBeUndefined()
    await expect(admitRegistryVersions(units, { allowMissing: false, fetcher: async () => new Response('', { status: 404 }) })).rejects.toThrow('HTTP 404')
    await expect(admitRegistryVersions(units, { allowMissing: true, fetcher: async () => metadata('sha512-other') })).rejects.toThrow('immutable bytes')
    await expect(admitRegistryVersions(units, { allowMissing: false, fetcher: async () => metadata('sha512-qualified') })).resolves.toBeUndefined()
  })

  it('rejects local and alternate-registry closure masquerading as npm qualification', () => {
    expect(() => assertNpmConsumerLock('resolution: {integrity: sha512-qualified}\n')).not.toThrow()
    for (const lock of [
      'version: file:../codegraph.tgz', 'version: link:../codegraph', 'specifier: workspace:*',
      'overrides: {}', 'resolution: {tarball: https://npm.pkg.github.com/package.tgz}',
      'resolution: {tarball: https://other.invalid/package.tgz}',
    ]) expect(() => assertNpmConsumerLock(lock)).toThrow()
  })
})

async function releaseFixture(corruption?: 'binary' | 'dependency' | 'version') {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-release-admission-'))
  temporary.push(root)
  const output = join(root, 'archives')
  await mkdir(output)
  const artifacts: Record<string, unknown> = {}
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const bytes = Buffer.from(`qualified ${target} executable`)
    const artifact = {
      target, package: expected.package, executable: expected.executable,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    artifacts[target] = artifact
    await packFixture(root, output, expected.package, {
      'package.json': { ...publicManifest(expected.package), os: [expected.os], cpu: [expected.cpu],
        ...(corruption === 'version' && target === 'linux-x64' ? { version: '0.0.0' } : {}),
      },
      'manifest.json': {
        format: 'astrale.codegraph.native-artifact', version: 1, packageVersion: version,
        protocolVersion: 1, artifact,
      },
      [expected.executable]: corruption === 'binary' && target === 'win32-x64' ? Buffer.from('changed') : bytes,
    })
  }
  await packFixture(root, output, '@astrale-os/codegraph', {
    'package.json': {
      ...publicManifest('@astrale-os/codegraph'),
      optionalDependencies: Object.fromEntries(Object.values(NATIVE_TARGETS).map(({ package: name }) =>
        [name, corruption === 'dependency' ? 'workspace:*' : version])),
    },
    'native-release.json': {
      format: 'astrale.codegraph.native-release', version: 1, packageVersion: version,
      protocolVersion: 1, sourceRevision: revision, artifacts,
      toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture' },
    },
  })
  return output
}

function publicManifest(name: string) {
  return { name, version, private: false, type: 'module',
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    repository: { url: `git+https://github.com/${repository}.git` },
  }
}

async function packFixture(root: string, output: string, name: string, files: Record<string, unknown>) {
  const slug = name.replace('@', '').replace('/', '-')
  const directory = join(root, slug)
  for (const [path, value] of Object.entries(files)) {
    const file = join(directory, 'package', path)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, Buffer.isBuffer(value) ? value : JSON.stringify(value))
  }
  await execFile('tar', ['-czf', join(output, `${slug}-${version}.tgz`), '-C', directory, 'package'])
}

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import {
  admitQualificationRun, admitRegistryVersions, admitReleasePackages, assertNpmConsumerLock,
} from '../scripts/native/admit-packages.mjs'
import { assertArtifact, assertOxlintArtifact, NATIVE_TARGETS, oxlintEligible, oxlintExecutable } from '../scripts/native/shared.mjs'

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

  it.each(['binary', 'dependency', 'version', 'oxlint', 'missing-oxlint', 'oxlint-source', 'notices'] as const)('rejects a torn %s publication cohort before publishing', async (corruption) => {
    await expect(admitReleasePackages(await releaseFixture(corruption), revision, version)).rejects.toThrow()
  })

  it('reads historical Go-only artifacts but requires a worker for a new release', () => {
    const target = 'darwin-arm64'
    const artifact = { target, package: NATIVE_TARGETS[target].package,
      executable: NATIVE_TARGETS[target].executable, bytes: 1, sha256: '0'.repeat(64) }
    expect(() => assertArtifact(artifact, target, version)).not.toThrow()
    expect(() => assertArtifact(artifact, target, version, { requireOxlint: true })).toThrow('no qualified')
  })

  it.each(Object.keys(NATIVE_TARGETS))('binds the worker filename, engine, protocol and source for %s', (target) => {
    const descriptor = oxlintDescriptor(target, Buffer.from('schema fixture'))
    if (!oxlintEligible(target)) {
      expect(() => assertOxlintArtifact(descriptor, target)).toThrow()
      return
    }
    expect(() => assertOxlintArtifact(descriptor, target)).not.toThrow()
    for (const changed of [
      { executable: '../codegraph-oxlint' }, { executable: 'bin/captured-owned-oxlint-1.81.0' },
      { bytes: 0 }, { sha256: 'invalid' }, { engineVersion: '1.78.0' }, { protocolVersion: 2 },
      { source: { ...descriptor.source, revision: 'main' } },
      { source: { ...descriptor.source, patchSha256: 'invalid' } },
    ]) expect(() => assertOxlintArtifact({ ...descriptor, ...changed }, target)).toThrow()
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

describe('downloaded native artifact assembly', () => {
  it.skipIf(process.platform === 'win32')('stages authenticated 0644 Go and workers as executable copies without changing downloads', async () => {
    const fixture = await assemblyFixture()
    await execFile(process.execPath, ['scripts/native/assemble.mjs', '--input', fixture.input], { cwd: fixture.root })
    const release = JSON.parse(await readFile(join(fixture.root, 'native-release.json'), 'utf8'))
    expect(Object.keys(release.artifacts)).toEqual(Object.keys(NATIVE_TARGETS))
    expect(release.artifacts['win32-x64'].oxlint).toBeUndefined()
    for (const file of fixture.files) {
      expect(await readFile(file.source)).toEqual(file.bytes)
      expect((await stat(file.source)).mode & 0o777).toBe(0o644)
      expect(await readFile(file.destination)).toEqual(file.bytes)
      expect((await stat(file.destination)).mode & 0o777).toBe(0o755)
      expect(createHash('sha256').update(await readFile(file.destination)).digest('hex')).toBe(file.sha256)
    }
  })

  it.skipIf(process.platform === 'win32').each(['Go', 'worker'] as const)('rejects same-length %s corruption before staging those bytes', async (kind) => {
    const fixture = await assemblyFixture()
    const file = fixture.files[kind === 'Go' ? 0 : 1]!
    const corrupted = Buffer.from(file.bytes)
    corrupted[0] = corrupted[0]! ^ 1
    await writeFile(file.source, corrupted)
    await expect(execFile(process.execPath, ['scripts/native/assemble.mjs', '--input', fixture.input], { cwd: fixture.root }))
      .rejects.toThrow('bytes differ from its build manifest')
    await expect(stat(file.destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(file.source)).toEqual(corrupted)
  })

  it.skipIf(process.platform === 'win32').each(['symlink', 'directory'] as const)('rejects a downloaded %s instead of following or normalizing it', async (kind) => {
    const fixture = await assemblyFixture()
    const file = fixture.files[0]!
    const foreign = join(fixture.root, 'foreign')
    await writeFile(foreign, file.bytes, { mode: 0o644 })
    await rm(file.source)
    if (kind === 'symlink') await symlink(foreign, file.source)
    else await mkdir(file.source)
    await expect(execFile(process.execPath, ['scripts/native/assemble.mjs', '--input', fixture.input], { cwd: fixture.root }))
      .rejects.toThrow('downloaded artifact is not a regular file')
    await expect(stat(file.destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(foreign)).toEqual(file.bytes)
    expect((await stat(foreign)).mode & 0o777).toBe(0o644)
  })
})

// These synthetic files qualify transport/assembly only and are never executed.
async function assemblyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-assembly-transport-'))
  temporary.push(root)
  const input = join(root, 'downloads')
  const scripts = join(root, 'scripts/native')
  await mkdir(scripts, { recursive: true })
  for (const name of ['assemble.mjs', 'shared.mjs']) {
    await copyFile(new URL(`../scripts/native/${name}`, import.meta.url), join(scripts, name))
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ version, type: 'module' }))
  await writeFile(join(root, 'LICENSE'), 'assembly license fixture\n')
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'assembly notices fixture\n')
  const files: { source: string, destination: string, bytes: Buffer, sha256: string }[] = []
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const bytes = Buffer.from(`assembly fixture ${target} Go`)
    const workerBytes = Buffer.from(`assembly fixture ${target} worker`)
    const worker = oxlintDescriptor(target, workerBytes)
    const artifact = { target, package: expected.package, executable: expected.executable,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(oxlintEligible(target) ? { oxlint: worker } : {}),
    }
    const source = join(input, target)
    const destination = join(root, 'native-packages', target)
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'package.json'), JSON.stringify(publicManifest(expected.package)))
    const toolchain = { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture',
      ...(oxlintEligible(target) ? { oxlint: { rustc: 'fixture', cargo: 'fixture', cargoLockSha256: '5'.repeat(64) } } : {}),
    }
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'manifest.json'), JSON.stringify({
      format: 'astrale.codegraph.native-artifact', version: 1, packageVersion: version, protocolVersion: 1, artifact,
    }))
    await writeFile(join(source, 'build.json'), JSON.stringify({
      format: 'astrale.codegraph.native-build', version: 1, packageVersion: version, protocolVersion: 1,
      source: { revision, dirty: false }, toolchain, artifact,
    }))
    for (const record of [{ descriptor: artifact, bytes },
      ...(oxlintEligible(target) ? [{ descriptor: worker, bytes: workerBytes }] : [])]) {
      const path = join(source, record.descriptor.executable)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, record.bytes)
      await chmod(path, 0o644)
      files.push({ source: path, destination: join(destination, record.descriptor.executable),
        bytes: record.bytes, sha256: record.descriptor.sha256 })
    }
  }
  return { root, input, files }
}

async function releaseFixture(corruption?: 'binary' | 'dependency' | 'version' | 'oxlint' | 'missing-oxlint' | 'oxlint-source' | 'notices') {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-release-admission-'))
  temporary.push(root)
  const output = join(root, 'archives')
  await mkdir(output)
  const artifacts: Record<string, unknown> = {}
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const bytes = Buffer.from(`qualified ${target} executable`)
    const workerBytes = Buffer.from(`archive admission fixture ${target} worker`)
    const oxlint = oxlintDescriptor(target, workerBytes)
    if (corruption === 'oxlint-source' && target === 'linux-x64') oxlint.source.patchSha256 = '6'.repeat(64)
    const artifact = {
      target, package: expected.package, executable: expected.executable,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(oxlintEligible(target) && !(corruption === 'missing-oxlint' && target === 'linux-x64') ? { oxlint } : {}),
    }
    artifacts[target] = artifact
    await packFixture(root, output, expected.package, {
      'LICENSE': Buffer.from('release license fixture\n'),
      'THIRD_PARTY_NOTICES.md': Buffer.from(corruption === 'notices' && target === 'linux-x64'
        ? 'torn notices fixture\n' : 'release third-party notices fixture\n'),
      'package.json': { ...publicManifest(expected.package), os: [expected.os], cpu: [expected.cpu],
        ...(corruption === 'version' && target === 'linux-x64' ? { version: '0.0.0' } : {}),
      },
      'manifest.json': {
        format: 'astrale.codegraph.native-artifact', version: 1, packageVersion: version,
        protocolVersion: 1, artifact,
      },
      [expected.executable]: corruption === 'binary' && target === 'win32-x64' ? Buffer.from('changed') : bytes,
      ...(oxlintEligible(target) ? { [oxlint.executable]: corruption === 'oxlint' && target === 'linux-x64' ? Buffer.from('changed') : workerBytes } : {}),
    })
  }
  await packFixture(root, output, '@astrale-os/codegraph', {
    'LICENSE': Buffer.from('release license fixture\n'),
    'THIRD_PARTY_NOTICES.md': Buffer.from('release third-party notices fixture\n'),
    'package.json': {
      ...publicManifest('@astrale-os/codegraph'),
      optionalDependencies: Object.fromEntries(Object.values(NATIVE_TARGETS).map(({ package: name }) =>
        [name, corruption === 'dependency' ? 'workspace:*' : version])),
    },
    'native-release.json': {
      format: 'astrale.codegraph.native-release', version: 1, packageVersion: version,
      protocolVersion: 1, sourceRevision: revision, artifacts,
      toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture',
        oxlint: { rustc: 'fixture', cargo: 'fixture', cargoLockSha256: '5'.repeat(64) } },
    },
  })
  return output
}

function oxlintDescriptor(target: string, bytes: Buffer) {
  return { executable: oxlintExecutable(target), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), engineVersion: '1.81.0', protocolVersion: 1,
    source: { revision: '3'.repeat(40), patchSha256: '4'.repeat(64) } }
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

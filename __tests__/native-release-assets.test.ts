import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

import { assertArtifact, nativeReleaseAssetName, NATIVE_TARGETS } from '../scripts/native/shared.mjs'

const execFile = promisify(execFileCallback)
const sourceRevision = 'a'.repeat(40), packageVersion = '0.1.3'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const integrity = (bytes: Buffer) => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })

// Synthetic executable bytes qualify producer/admission invariants only. Real
// installed remote behavior requires the CI-produced assets on public release URLs.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codegraph-release-assets-')); roots.push(root)
  await cp(resolve(import.meta.dirname, '../scripts/native'), join(root, 'scripts/native'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: packageVersion, files: ['dist', 'native-release.json'],
    repository: { url: 'git+https://github.com/astrale-os/exp-codegraph.git' },
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' } }))
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'ttsc TypeScript-Go Go toolchain Oxlint')
  const originals = new Map<string, Buffer>()
  for (const [target, expected] of Object.entries(NATIVE_TARGETS)) {
    const input = join(root, 'input', target), bytes = Buffer.from(`qualified ${target} fixture\n`.repeat(100))
    const artifact = { target, executable: expected.executable, ...integrity(bytes), ...(expected.oxlint ? { oxlint: {
      executable: 'bin/codegraph-oxlint', ...integrity(Buffer.from(`worker ${target} fixture\n`.repeat(100))),
      engineVersion: '1.81.0', protocolVersion: 1, source: { revision: 'b'.repeat(40), patchSha256: 'c'.repeat(64) },
    } } : {}) }
    for (const record of [artifact, ...(artifact.oxlint ? [artifact.oxlint] : [])]) {
      const file = join(input, record.executable)
      await mkdir(dirname(file), { recursive: true })
      const value = record === artifact ? bytes : Buffer.from(`worker ${target} fixture\n`.repeat(100))
      await writeFile(file, value)
      originals.set(nativeReleaseAssetName(target, record === artifact ? 'native' : 'oxlint', sourceRevision)!, value)
    }
    const identity = { version: 1, packageVersion, protocolVersion: 1, artifact }
    await writeFile(join(input, 'manifest.json'), JSON.stringify({ ...identity, format: 'astrale.codegraph.native-artifact' }))
    await writeFile(join(input, 'build.json'), JSON.stringify({ ...identity, format: 'astrale.codegraph.native-build',
      source: { revision: sourceRevision, dirty: false }, toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture',
        ...(expected.oxlint ? { oxlint: { rustc: 'fixture', cargo: 'fixture', cargoLockSha256: 'd'.repeat(64) } } : {}) } }))
  }
  const assets = join(root, 'assets')
  const assemble = () => execFile(process.execPath, [join(root, 'scripts/native/assemble.mjs'), '--input', join(root, 'input'), '--assets-dir', assets])
  const admit = () => execFile(process.execPath, [join(root, 'scripts/native/assert-release.mjs'), '--source-revision', sourceRevision, '--assets-dir', assets])
  return { root, assets, originals, assemble, admit }
}

describe('external native release assets', () => {
  it('assembles exactly seven source-bound gzip assets and the identical lightweight npm header', async () => {
    const f = await fixture(); await f.assemble(); await f.admit()
    expect((await readdir(f.assets)).sort()).toEqual([...f.originals.keys(), 'native-release.json'].sort())
    expect(await readFile(join(f.assets, 'native-release.json'))).toEqual(await readFile(join(f.root, 'native-release.json')))
    const release = JSON.parse(await readFile(join(f.root, 'native-release.json'), 'utf8'))
    expect(release).toMatchObject({ delivery: 'github-release', sourceRevision, packageVersion })
    expect(Object.keys(release.artifacts).sort()).toEqual(Object.keys(NATIVE_TARGETS).sort())
    for (const [name, original] of f.originals) expect(gunzipSync(await readFile(join(f.assets, name)))).toEqual(original)
    await expect(readdir(join(f.root, 'native-artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
    // Reassembly is idempotent and deterministic for the same frozen inputs.
    const header = await readFile(join(f.root, 'native-release.json'))
    await f.assemble(); await f.admit()
    expect(await readFile(join(f.root, 'native-release.json'))).toEqual(header)
  }, 30_000)

  it.each(['encoded-corruption', 'header-drift', 'unexpected-asset', 'source-relabel'] as const)('rejects %s before release admission', async (kind) => {
    const f = await fixture(); await f.assemble()
    if (kind === 'encoded-corruption') await writeFile(join(f.assets, f.originals.keys().next().value!), 'corrupt')
    if (kind === 'header-drift') await writeFile(join(f.assets, 'native-release.json'), '{}')
    if (kind === 'unexpected-asset') await writeFile(join(f.assets, 'extra.gz'), 'unqualified')
    if (kind === 'source-relabel') {
      const path = join(f.root, 'native-release.json'), value = JSON.parse(await readFile(path, 'utf8'))
      value.sourceRevision = 'e'.repeat(40); await writeFile(path, JSON.stringify(value))
    }
    await expect(f.admit()).rejects.toThrow()
  }, 30_000)

  it('binds remote Go and companion names to the declared source while retaining old raw and encoded admissions', () => {
    const target = 'darwin-arm64', original = integrity(Buffer.from('fixture'))
    const artifact = { target, executable: 'bin/codegraph-native', ...original }
    expect(assertArtifact(artifact, target, packageVersion)).toBe(artifact)
    const encoded = { ...artifact, compression: { format: 'gzip', path: 'bin/codegraph-native.gz', ...original } }
    expect(assertArtifact(encoded, target, packageVersion)).toBe(encoded)
    expect(() => assertArtifact(encoded, target, packageVersion, { delivery: 'github-release', sourceRevision })).toThrow('not bound')
    const remote = { ...encoded, compression: { ...encoded.compression, path: nativeReleaseAssetName(target, 'native', sourceRevision) } }
    expect(assertArtifact(remote, target, packageVersion, { delivery: 'github-release', sourceRevision })).toBe(remote)
    expect(() => assertArtifact(remote, target, packageVersion, { delivery: 'github-release', sourceRevision: 'e'.repeat(40) })).toThrow('not bound')
    expect(() => assertArtifact(remote, target, packageVersion, { delivery: 'https://another.host' })).toThrow('Unknown')
    expect(() => assertArtifact({ ...artifact, compression: { format: 'gzip', ...original } }, target, packageVersion)).toThrow('invalid compressed')
  })
})

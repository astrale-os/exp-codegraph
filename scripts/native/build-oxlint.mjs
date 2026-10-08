import { execFile as execFileCallback } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  assertOxlintArtifact, digestFile, NATIVE_TARGETS, OXLINT_ENGINE_VERSION,
  OXLINT_PROTOCOL_VERSION, oxlintExecutable, readJson, stableJson, within,
} from './shared.mjs'

const execFile = promisify(execFileCallback)
const triples = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
}

export async function readOxlintRecipe(root) {
  const sourceRoot = resolve(root, 'analysis/oxlint')
  const recipe = await readJson(resolve(sourceRoot, 'native-source.json'))
  if (
    recipe.version !== 1 || recipe.engineVersion !== OXLINT_ENGINE_VERSION ||
    recipe.protocolVersion !== OXLINT_PROTOCOL_VERSION ||
    recipe.repository !== 'https://github.com/oxc-project/oxc.git' ||
    typeof recipe.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(recipe.revision) ||
    !recipe.patch || typeof recipe.patch.path !== 'string' ||
    !/^patches\/[A-Za-z0-9._-]+\.patch$/u.test(recipe.patch.path) ||
    typeof recipe.patch.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(recipe.patch.sha256) ||
    typeof recipe.cargoLockSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(recipe.cargoLockSha256) ||
    !recipe.ignoreVendor || recipe.ignoreVendor.version !== '0.4.33' || recipe.ignoreVendor.path !== 'vendor/ignore' ||
    typeof recipe.ignoreVendor.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(recipe.ignoreVendor.archiveSha256) ||
    typeof recipe.rustToolchain !== 'string' || !/^(?:\d+\.\d+\.\d+|nightly-\d{4}-\d{2}-\d{2})$/u.test(recipe.rustToolchain) ||
    !['bin', 'example'].includes(recipe.artifactKind) ||
    ![recipe.package, recipe.binary].every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/u.test(value))
  ) throw new Error('Invalid pinned codegraph-oxlint source recipe.')
  const patch = resolve(sourceRoot, recipe.patch.path)
  if (!within(sourceRoot, patch) || (await digestFile(patch)).sha256 !== recipe.patch.sha256) {
    throw new Error('codegraph-oxlint patch differs from its pinned source recipe.')
  }
  return { recipe, patch }
}

export async function prepareOxlintToolchain(root) {
  const { recipe } = await readOxlintRecipe(root)
  const target = `${process.platform}-${process.arch}`
  const triple = triples[target]
  if (!triple) throw new Error('Unsupported codegraph-oxlint build target.')
  await execFile('rustup', ['toolchain', 'install', recipe.rustToolchain, '--profile', 'minimal'])
  await execFile('rustup', ['target', 'add', '--toolchain', recipe.rustToolchain, triple])
}

/** Build from pinned source; never accept a caller-supplied precompiled worker. */
export async function buildOxlint({ root, target, output, cacheDirectory }) {
  if (!NATIVE_TARGETS[target] || target !== `${process.platform}-${process.arch}`) {
    throw new Error(`codegraph-oxlint must be built on its actual native target: ${target}.`)
  }
  const { recipe, patch } = await readOxlintRecipe(root)
  const cache = resolve(cacheDirectory ?? resolve(root, '.cache/oxlint'))
  await mkdir(cache, { recursive: true })
  const checkout = await mkdtemp(resolve(cache, 'source-'))
  const run = async (command, args, options = {}) => execFile(command, args, {
    cwd: checkout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options,
  })
  try {
    await run('git', ['init', '--quiet'])
    await run('git', ['fetch', '--quiet', '--depth=1', '--no-tags', recipe.repository, recipe.revision])
    await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'])
    if ((await run('git', ['rev-parse', 'HEAD'])).stdout.trim() !== recipe.revision) {
      throw new Error('codegraph-oxlint upstream source revision differs.')
    }
    // The ignore fork is a delta against the published crate, not a second
    // checked-in copy of the whole upstream source tree.
    const vendorArchive = resolve(checkout, '.codegraph-ignore.crate')
    const response = await fetch('https://static.crates.io/crates/ignore/ignore-0.4.33.crate', {
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok) throw new Error(`Cannot fetch pinned ignore source: HTTP ${response.status}.`)
    const vendorBytes = new Uint8Array(await response.arrayBuffer())
    if (vendorBytes.length > 8 * 1024 * 1024) throw new Error('Pinned ignore source exceeds its archive bound.')
    await writeFile(vendorArchive, vendorBytes)
    if ((await digestFile(vendorArchive)).sha256 !== recipe.ignoreVendor.archiveSha256) {
      throw new Error('Published ignore source differs from its pinned archive.')
    }
    const vendor = resolve(checkout, recipe.ignoreVendor.path)
    await mkdir(vendor, { recursive: true })
    await run('tar', ['-xzf', vendorArchive, '-C', vendor, '--strip-components=1'])
    await rm(vendorArchive)
    await run('git', ['apply', '--check', patch])
    await run('git', ['apply', patch])
    if ((await digestFile(resolve(checkout, 'Cargo.lock'))).sha256 !== recipe.cargoLockSha256) {
      throw new Error('codegraph-oxlint Cargo.lock differs from the pinned patched source.')
    }
    const cargoArgs = [`+${recipe.rustToolchain}`]
    const rustc = (await run('rustc', [...cargoArgs, '--version'])).stdout.trim()
    const cargo = (await run('cargo', [...cargoArgs, '--version'])).stdout.trim()
    const environment = { ...process.env,
      CARGO_HOME: resolve(cache, 'cargo-home'),
      CARGO_TARGET_DIR: resolve(cache, 'target'),
      // The checkout is temporary. Its pathname must not enter the delivered binary.
      CARGO_ENCODED_RUSTFLAGS: [
        `--remap-path-prefix=${checkout}=codegraph-oxlint-source`,
        `--remap-path-prefix=${resolve(cache, 'cargo-home')}=codegraph-oxlint-cargo`,
      ].join('\u001f'),
    }
    for (const name of Object.keys(environment)) {
      if (/^(?:RUSTFLAGS|RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTDOC|CARGO_BUILD_RUSTC.*|CARGO_PROFILE_.*)$/u.test(name)) {
        delete environment[name]
      }
    }
    const nativeArgs = ['--locked', '--release', '--jobs', '4', '--target', triples[target]]
    // Qualify both owners before delivering bytes. The authority's tests are
    // integration tests, so --lib would silently omit its discovery guards.
    for (const selection of [
      ['--package', recipe.package, `--${recipe.artifactKind}`, recipe.binary],
      ['--package', 'oxlint-capture-authority'],
    ]) {
      const tested = await run('cargo', [...cargoArgs, 'test', ...nativeArgs, ...selection], { env: environment })
      // Keep the builder's JSON stdout intact; retain actual unit outcomes in
      // its stderr log. Any failed Cargo process prevents artifact delivery.
      process.stderr.write(tested.stdout)
      process.stderr.write(tested.stderr)
    }
    await run('cargo', [...cargoArgs, 'build', ...nativeArgs, '--package', recipe.package,
      `--${recipe.artifactKind}`, recipe.binary], { env: environment })
    const original = resolve(environment.CARGO_TARGET_DIR, triples[target], 'release',
      ...(recipe.artifactKind === 'example' ? ['examples'] : []), recipe.binary)
    const executable = oxlintExecutable(target)
    const destination = resolve(output, executable)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(original, destination)
    await chmod(destination, 0o755)
    const artifact = assertOxlintArtifact({ executable, ...await digestFile(destination),
      engineVersion: recipe.engineVersion, protocolVersion: recipe.protocolVersion,
      source: { revision: recipe.revision, patchSha256: recipe.patch.sha256 } }, target)
    return { artifact, toolchain: { rustc, cargo, cargoLockSha256: recipe.cargoLockSha256 } }
  } finally {
    await rm(checkout, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv.includes('--prepare-toolchain')) throw new Error('Use --prepare-toolchain or import buildOxlint from the native builder.')
  const root = resolve(import.meta.dirname, '../..')
  await prepareOxlintToolchain(root)
  process.stdout.write(stableJson({ prepared: (await readOxlintRecipe(root)).recipe.rustToolchain }))
}

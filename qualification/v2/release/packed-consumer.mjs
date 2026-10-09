import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { assertNpmConsumerLock } from '../../../scripts/native/admit-packages.mjs'
import { NATIVE_ARTIFACT_DIRECTORY, NATIVE_TARGETS, assertOxlintArtifact } from '../../../scripts/native/shared.mjs'
import { qualifyOwnedGeneric } from './owned-generic.mjs'
import { qualifyResidentProject } from './resident.mjs'

const execFile = promisify(execFileCallback)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const releasePath = argument('--release-directory')
const npmVersion = argument('--npm-version')
const sourceRevision = argument('--source-revision')
assert(Boolean(releasePath) !== Boolean(npmVersion), 'Select packed archives or an exact npm version.')
const releaseDirectory = releasePath ? resolve(releasePath) : undefined
if (npmVersion) {
  assert.match(npmVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  assert.match(sourceRevision ?? '', /^[a-f0-9]{40}$/u)
}
const npmRegistry = 'https://registry.npmjs.org/'
const releaseAgeExclusions = [
  '@astrale-os/*',
  '@astrale-domains/*',
  '@astrale/*',
  'create-astrale-domain',
  'bun-types@1.4.0',
]
const target = `${process.platform}-${process.arch}`
assert(NATIVE_TARGETS[target], `Unsupported packed-consumer target ${target}.`)

const temporary = await mkdtemp(join(tmpdir(), 'codegraph-packed-consumer-'))
try {
  const archive = releaseDirectory ? await releaseArchive(releaseDirectory) : undefined
  const consumer = join(temporary, 'consumer')
  await mkdir(consumer, { recursive: true })
  const dependencyEnvironment = await prepareConsumerPolicy(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: '@fixture/codegraph-release-consumer',
      private: true,
      type: 'module',
      packageManager: 'pnpm@11.13.1',
    }),
  )
  const pnpmArguments = [
    'add',
    '--dir',
    consumer,
    '--prefer-offline',
    '--ignore-scripts',
    '--save-exact',
    releaseDirectory ? resolve(releaseDirectory, archive) : `@astrale-os/codegraph@${npmVersion}`,
  ]
  await runPnpm(pnpmArguments, dependencyEnvironment)
  const lock = await readFile(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  if (releaseDirectory) await assertPackedConsumerLock(lock, consumer, resolve(releaseDirectory, archive))
  else assertNpmConsumerLock(lock)

  const installed = join(consumer, 'node_modules/@astrale-os/codegraph')
  const rootManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.notEqual(rootManifest.private, true)
  assert.equal(rootManifest.publishConfig?.registry, npmRegistry)
  assert.equal(rootManifest.publishConfig?.access, 'public')
  if (npmVersion) assert.equal(rootManifest.version, npmVersion)
  if (sourceRevision) {
    const release = JSON.parse(await readFile(join(installed, 'native-release.json'), 'utf8'))
    assert.equal(release.sourceRevision, sourceRevision)
  }
  assert.equal(rootManifest.dependencies?.ttsc, undefined)
  assert.equal(rootManifest.optionalDependencies, undefined)
  await assertMissing(join(consumer, 'node_modules/ttsc'))
  await assertMissing(join(consumer, 'node_modules/@ttsc'))
  const rootFiles = await filesUnder(installed)
  const forbidden = rootFiles.filter(
    (path) =>
      path.endsWith('.map') ||
      path.includes('/analysis/typescript/native/') ||
      path.includes('/analysis/typescript/ttsc/') || path.includes('/analysis/oxlint/') ||
      /(?:^|\/)(?:Cargo\.toml|Cargo\.lock|rust-toolchain\.toml)$/u.test(path) || path.endsWith('.rs') ||
      /(?:^|\/)(?:go(?:\.exe)?|go\.mod|go\.sum)$/u.test(path) ||
      path.endsWith('.go'),
  )
  assert.deepEqual(forbidden, [], `Production package leaked compiler inputs: ${forbidden.join(', ')}`)
  const cli = join(installed, 'dist/cli.js')
  const version = await execFile(process.execPath, [cli, '--version'], { cwd: consumer })
  assert.equal(version.stderr, '')
  assert.equal(version.stdout.trim(), rootManifest.version)

  const typescript = await import(
    pathToFileURL(join(installed, 'dist/analysis/typescript/index.js')).href
  )
  const analysis = await import(pathToFileURL(join(installed, 'dist/analysis/index.js')).href)
  const native = await typescript.resolvePackagedNativeAnalysis()
  assert.equal(native.origin, 'package')
  assert.equal(native.target, target)
  const installedNative = await realpath(join(installed, NATIVE_ARTIFACT_DIRECTORY))
  assert(isAbsolute(native.command))
  assert.equal((await typescript.resolvePackagedNativeAnalysis()).command, native.command,
    'Repeated resolution must reuse the admitted content cache.')
  const release = JSON.parse(await readFile(join(installed, 'native-release.json'), 'utf8'))
  assert.deepEqual(Object.keys(release.artifacts).sort(), Object.keys(NATIVE_TARGETS).sort())
  const analyzer = release.artifacts[target]
  const originalNative = await readFile(native.command)
  assert.equal(originalNative.length, analyzer.bytes)
  assert.equal(createHash('sha256').update(originalNative).digest('hex'), analyzer.sha256)
  if (analyzer.compression) await assertMissing(join(installedNative, target, analyzer.executable))
  const oxlint = analyzer.oxlint
  let ownedGeneric = { status: 'unavailable', reason: 'NATIVE_OXLINT_UNAVAILABLE' }
  if (process.argv.includes('--require-oxlint')) {
    assert.equal(Boolean(oxlint), NATIVE_TARGETS[target].oxlint,
      'Release worker delivery must match the qualified host capability.')
  }
  if (oxlint) {
    assertOxlintArtifact(oxlint, target)
    const nativeWorker = await typescript.resolvePackagedNativeOxlint()
    assert.equal(nativeWorker.origin, 'package')
    assert.equal(nativeWorker.target, target)
    assert.equal(nativeWorker.packageVersion, rootManifest.version)
    assert.equal(nativeWorker.sha256, oxlint.sha256)
    assert.equal(nativeWorker.bytes, oxlint.bytes)
    assert.equal(nativeWorker.engineVersion, oxlint.engineVersion)
    assert.equal(nativeWorker.protocolVersion, oxlint.protocolVersion)
    assert.deepEqual(nativeWorker.source, oxlint.source)
    const worker = nativeWorker.command
    assert.equal((await typescript.resolvePackagedNativeOxlint()).command, worker)
    const bytes = await readFile(worker)
    assert.equal(bytes.length, oxlint.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), oxlint.sha256)
    assert((await stat(worker)).isFile())
    if (process.platform !== 'win32') assert((await stat(worker)).mode & 0o111)
  } else {
    await assert.rejects(typescript.resolvePackagedNativeOxlint(), { code: 'NATIVE_OXLINT_UNAVAILABLE', target })
  }
  // The one package delivers every released target and nothing else beside them.
  const nativeFiles = (await filesUnder(installedNative)).map((path) => path.slice(installedNative.length + 1))
  assert.deepEqual(nativeFiles.sort(), Object.entries(release.artifacts).flatMap(([name, artifact]) => [
    `${name}/${artifact.compression?.path ?? artifact.executable}`,
    ...(artifact.oxlint ? [`${name}/${artifact.oxlint.compression?.path ?? artifact.oxlint.executable}`] : []),
  ]).sort())



  const project = join(temporary, 'project')
  await cp(resolve(repositoryRoot, 'qualification/v2/ttsc/fixtures/adversarial'), project, {
    recursive: true,
  })
  const store = analysis.createMemoryAnalysisStore()
  const service = await typescript.createTypeScriptAnalysisService({
    project: {
      root: project,
      config: 'tsconfig.json',
      capabilities: [
        'astrale.typescript.module',
        'typescript.body',
        'typescript.diagnostic',
        'typescript.occurrence',
        'typescript.project',
        'typescript.source',
        'typescript.symbol',
      ],
      modules: [
        {
          id: 'fixture.sdk',
          name: 'FixtureSdk',
          project: 'tsconfig.json',
          root: 'src/sdk',
          entrypoint: 'src/sdk/index.ts',
          facades: [],
          aliases: [],
          internals: [],
        },
      ],
    },
    sessions: analysis.createProcessNativeAnalysisSessionFactory({ command: native.command }),
    store,
  })
  try {
    const refreshed = await service.refresh()
    assert.deepEqual(refreshed.diagnostics, [])
    const query = await store.open(refreshed.generation.universe, refreshed.generation.id)
    try {
      let diagnostics = 0
      let bodies = 0
      let occurrences = 0
      let modules = 0
      const states = new Set()
      for await (const fact of typescript.createTypeScriptFactReader(query).exportAll()) {
        if (fact.namespace === 'typescript.diagnostic') diagnostics++
        else if (fact.namespace === 'typescript.body') {
          bodies++
          for (const value of Object.values(fact.payload.values)) states.add(value.kind)
        } else if (fact.namespace === 'typescript.occurrence') occurrences++
        else if (fact.namespace === 'astrale.typescript.module') modules++
      }
      assert.equal(diagnostics, 0)
      assert(bodies > 0)
      assert(occurrences > 0)
      assert(modules > 0)
      assert.deepEqual([...states].sort(), ['ambiguous', 'known', 'unknown', 'unsupported'])
    } finally {
      await query.dispose()
    }
  } finally {
    await service.dispose()
    await store.dispose()
  }

  const resident = await qualifyResidentProject(typescript, join(temporary, 'resident'))
  if (oxlint) {
    const decisions = await import(pathToFileURL(join(installed, 'dist/analysis/native/index.js')).href)
    ownedGeneric = await qualifyOwnedGeneric({ decisions, worker: oxlint,
      root: join(temporary, 'owned-generic'), repositoryRoot })
  }

  process.stdout.write(
    `${JSON.stringify({ packageVersion: rootManifest.version, target, node: process.version, nativeSha256: native.sha256, source: npmVersion ? 'npmjs' : 'packed-artifact', resident, ownedGeneric })}\n`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

// A Windows package-manager shim is a .cmd file, not a process executable.
// Resolve its installed Node entry rather than adding a shell to package install.
async function runPnpm(args, env) {
  if (process.platform !== 'win32') return execFile('pnpm', args, { cwd: repositoryRoot, env })
  const { stdout } = await execFile('where.exe', ['pnpm'], { env })
  for (const shim of stdout.split(/\r?\n/u).filter(Boolean)) {
    if (shim.toLowerCase().endsWith('.exe')) return execFile(shim, args, { cwd: repositoryRoot, env })
    for (const entry of [
      resolve(shim, '../node_modules/pnpm/bin/pnpm.cjs'),
      resolve(shim, '../../pnpm/bin/pnpm.cjs'),
    ]) {
      try {
        if ((await stat(entry)).isFile()) return execFile(process.execPath, [entry, ...args], { cwd: repositoryRoot, env })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  throw new Error('Cannot resolve the installed pnpm Node entry from its Windows shim.')
}

async function prepareConsumerPolicy(consumer) {
  await writeFile(
    join(consumer, 'pnpm-workspace.yaml'),
    [
      'packages: []',
      'linkWorkspacePackages: false',
      'preferWorkspacePackages: false',
      'strictPeerDependencies: true',
      'minimumReleaseAge: 10080',
      'minimumReleaseAgeStrict: true',
      'minimumReleaseAgeIgnoreMissingTime: false',
      'trustLockfile: false',
      'minimumReleaseAgeExclude:',
      ...releaseAgeExclusions.map((name) => `  - '${name}'`),
      'verifyDepsBeforeRun: false',
      'allowBuilds: {}',
      '',
    ].join('\n'),
  )
  const userConfig = join(consumer, 'npmrc')
  const globalConfig = join(consumer, 'global-npmrc')
  await writeFile(
    userConfig,
    [
      `registry=${npmRegistry}`,
      `@astrale-os:registry=${npmRegistry}`,
      `@astrale-domains:registry=${npmRegistry}`,
      `@astrale:registry=${npmRegistry}`,
      '',
    ].join('\n'),
  )
  await writeFile(globalConfig, '')
  return neutralRegistryEnvironment(userConfig, globalConfig)
}

async function assertPackedConsumerLock(lock, consumer, archive) {
  assert.doesNotMatch(
    lock,
    /(?:^|[\s'",[{])(?:workspace:|link:|portal:|patch:|git:|git\+|github\.com|npm\.pkg\.github\.com|overrides:)/mu,
  )
  const qualified = await realpath(archive)
  const localTarballs = await Promise.all(
    [...lock.matchAll(/file:([^\s,}\]]+\.tgz)/gu)].map((match) =>
      realpath(match[1].startsWith('/') ? resolve(match[1]) : resolve(consumer, match[1])),
    ),
  )
  assert(localTarballs.length > 0)
  for (const tarball of localTarballs) {
    assert.equal(tarball, qualified, `Packed consumer lock contains unqualified tarball ${tarball}.`)
  }
}

function neutralRegistryEnvironment(userConfig, globalConfig) {
  const env = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(?:npm_config_|NPM_TOKEN$|NODE_AUTH_TOKEN$|GH_TOKEN$|GITHUB_TOKEN$|ACTIONS_ID_TOKEN_REQUEST_|ASTRALE_.*TOKEN$)/iu.test(name)) continue
    env[name] = value
  }
  return {
    ...env,
    NPM_CONFIG_USERCONFIG: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_REGISTRY: npmRegistry,
    npm_config_ignore_scripts: 'true',
  }
}

function exactlyOne(files, pattern) {
  const matches = files.filter((file) => pattern.test(file))
  if (matches.length !== 1) throw new Error(`Expected one ${pattern} archive; found ${matches.join(', ')}.`)
  return matches[0]
}

async function filesUnder(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...(await filesUnder(path)))
    else if (entry.isFile()) output.push(path.replaceAll('\\', '/'))
  }
  return output
}

async function assertMissing(path) {
  await assert.rejects(stat(path), { code: 'ENOENT' })
}

async function releaseArchive(directory) {
  return exactlyOne(await readdir(directory), /^astrale-os-codegraph-\d[^/]*\.tgz$/u)
}

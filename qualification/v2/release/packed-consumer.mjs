import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { assertNpmConsumerLock } from '../../../scripts/native/admit-packages.mjs'

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
const supported = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]
assert(supported.includes(target), `Unsupported packed-consumer target ${target}.`)

const temporary = await mkdtemp(join(tmpdir(), 'codegraph-packed-consumer-'))
try {
  const archives = releaseDirectory ? await releaseArchives(releaseDirectory) : []
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
    ...(releaseDirectory
      ? archives.map((archive) => resolve(releaseDirectory, archive))
      : [`@astrale-os/codegraph@${npmVersion}`]),
  ]
  await installConsumer(pnpmArguments, repositoryRoot, dependencyEnvironment)
  const lock = await readFile(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  if (releaseDirectory) await assertPackedConsumerLock(lock, consumer, releaseDirectory, archives)
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
  await assertMissing(join(consumer, 'node_modules/ttsc'))
  await assertMissing(join(consumer, 'node_modules/@ttsc'))
  const rootFiles = await filesUnder(installed)
  const forbidden = rootFiles.filter(
    (path) =>
      path.endsWith('.map') ||
      path.includes('/analysis/typescript/native/') ||
      path.includes('/analysis/typescript/ttsc/') ||
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
  const installedNative = resolve(native.command, '../..')
  const nativeFiles = (await filesUnder(installedNative)).map((path) => path.slice(installedNative.length + 1))
  assert.deepEqual(nativeFiles.sort(), [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    target === 'win32-x64' ? 'bin/codegraph-native.exe' : 'bin/codegraph-native',
    'manifest.json',
    'package.json',
  ])



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

  await qualifyResidentProject(typescript, join(temporary, 'resident'))

  process.stdout.write(
    `${JSON.stringify({ packageVersion: rootManifest.version, target, node: process.version, nativeSha256: native.sha256, source: npmVersion ? 'npmjs' : 'packed-artifact' })}\n`,
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

async function assertPackedConsumerLock(lock, consumer, releaseDirectory, archives) {
  assert.doesNotMatch(
    lock,
    /(?:^|[\s'",[{])(?:workspace:|link:|portal:|patch:|git:|git\+|github\.com|npm\.pkg\.github\.com|overrides:)/mu,
  )
  const allowed = new Set(
    await Promise.all(archives.map((archive) => realpath(resolve(releaseDirectory, archive)))),
  )
  const localTarballs = await Promise.all(
    [...lock.matchAll(/file:([^\s,}\]]+\.tgz)/gu)].map((match) =>
      realpath(match[1].startsWith('/') ? resolve(match[1]) : resolve(consumer, match[1])),
    ),
  )
  assert(localTarballs.length > 0)
  for (const tarball of localTarballs) {
    assert(allowed.has(tarball), `Packed consumer lock contains unqualified tarball ${tarball}.`)
  }
  assert.deepEqual(new Set(localTarballs), allowed)
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
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

async function installConsumer(arguments_, cwd, env) {
  if (process.platform !== 'win32') return execFile('pnpm', arguments_, { cwd, env })
  // Pass paths as JSON data: pnpm may be a .cmd shim, which execFile cannot execute on Windows.
  return execFile('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '$arguments = ConvertFrom-Json $env:CODEGRAPH_PNPM_ARGUMENTS; & pnpm @arguments; exit $LASTEXITCODE',
  ], { cwd, env: { ...env, CODEGRAPH_PNPM_ARGUMENTS: JSON.stringify(arguments_) } })
}

async function qualifyResidentProject(typescript, root) {
  await mkdir(root)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { noLib: true, target: 'ES2022' }, include: ['*.ts'],
  }))
  await writeFile(join(root, 'index.ts'), "export const helper = () => 'first'; export function value() { return helper() }\n")
  const project = await typescript.openTypeScriptProject({ root })
  try {
    const initial = await project.refresh()
    assert.equal(initial.transactions.length, 1)
    const before = await project.open(initial.generation)
    try {
      const original = await before.facts.facts('source')
      const bodies = await before.facts.facts('body')
      assert.equal(bodies.facts.length, 3)
      assert.equal(bodies.facts.filter((fact) => fact.payload.body.scope === 'module').length, 1)
      const values = await before.values()
      assert.equal(await before.values(), values)
      await writeFile(join(root, 'index.ts'), "export const helper = () => 'second'; export function value() { return helper() }\n")
      const edited = await project.refresh({ changed: ['index.ts'] })
      assert.notEqual(edited.generation.id, initial.generation.id)
      assert.equal((await project.refresh()).generation.id, edited.generation.id)
      assert.deepEqual((await project.refresh()).transactions, [])
      assert.deepEqual(await before.facts.facts('source'), original)
    } finally { await before.dispose() }
  } finally { await project.dispose() }
}

async function releaseArchives(directory) {
  const files = await readdir(directory)
  const rootArchive = exactlyOne(files, /^astrale-os-codegraph-\d[^/]*\.tgz$/u)
  const nativeArchives = supported.map((nativeTarget) => exactlyOne(files,
    new RegExp(`^astrale-os-codegraph-native-${escapeRegExp(nativeTarget)}-\\d[^/]*\\.tgz$`, 'u'),
  ))
  return [rootArchive, ...nativeArchives]
}

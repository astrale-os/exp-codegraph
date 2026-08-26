import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const releaseDirectory = resolve(requiredArgument('--release-directory'))
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
]
assert(supported.includes(target), `Unsupported packed-consumer target ${target}.`)

const temporary = await mkdtemp(join(tmpdir(), 'codegraph-packed-consumer-'))
try {
  const files = await readdir(releaseDirectory)
  const rootArchive = exactlyOne(files, /^astrale-os-codegraph-\d[^/]*\.tgz$/u)
  const nativeArchives = supported.map((nativeTarget) =>
    exactlyOne(
      files,
      new RegExp(
        `^astrale-os-codegraph-native-${escapeRegExp(nativeTarget)}-\\d[^/]*\\.tgz$`,
        'u',
      ),
    ),
  )
  const archives = [rootArchive, ...nativeArchives]
  const consumer = join(temporary, 'consumer')
  await mkdir(consumer, { recursive: true })
  const dependencyEnvironment = await prepareConsumerPolicy(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: '@fixture/codegraph-github-artifact-consumer',
      private: true,
      type: 'module',
      packageManager: 'pnpm@11.13.1',
    }),
  )
  await execFile(
    'pnpm',
    [
      'add',
      '--dir',
      consumer,
      '--prefer-offline',
      '--ignore-scripts',
      '--save-exact',
      ...archives.map((archive) => resolve(releaseDirectory, archive)),
    ],
    { cwd: repositoryRoot, env: dependencyEnvironment },
  )
  const lock = await readFile(join(consumer, 'pnpm-lock.yaml'), 'utf8')
  await assertPackedConsumerLock(lock, consumer, releaseDirectory, archives)

  const installed = join(consumer, 'node_modules/@astrale-os/codegraph')
  const installedNative = join(consumer, 'node_modules/@astrale-os', `codegraph-native-${target}`)
  const rootManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(rootManifest.private, true)
  assert.equal(rootManifest.publishConfig, undefined)
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
  const nativeFiles = (await filesUnder(installedNative)).map((path) => path.slice(installedNative.length + 1))
  assert.deepEqual(nativeFiles.sort(), [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'bin/codegraph-native',
    'manifest.json',
    'package.json',
  ])

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

  process.stdout.write(
    `${JSON.stringify({ packageVersion: rootManifest.version, target, nativeSha256: native.sha256, source: 'github-artifact' })}\n`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
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
    if (/^(?:npm_config_|NPM_TOKEN$|NODE_AUTH_TOKEN$|GH_TOKEN$|GITHUB_TOKEN$)/iu.test(name)) continue
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

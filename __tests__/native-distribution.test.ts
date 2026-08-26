import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  NativeAnalysisDistributionError,
  resolvePackagedNativeAnalysis,
} from '../analysis/typescript/distribution/index.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  .version as string
const temporary: string[] = []
const target = `${process.platform}-${process.arch}` as keyof typeof targets
const targets = {
  'darwin-arm64': '@astrale-os/codegraph-native-darwin-arm64',
  'darwin-x64': '@astrale-os/codegraph-native-darwin-x64',
  'linux-arm64': '@astrale-os/codegraph-native-linux-arm64',
  'linux-x64': '@astrale-os/codegraph-native-linux-x64',
} as const

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('native analysis distribution', () => {
  it('admits an explicit application-controlled executable without ttsc or a release artifact', async () => {
    const root = await directory('codegraph-explicit-native-')
    const binary = join(root, 'native')
    const content = Buffer.from('qualified explicit native fixture\n')
    await writeFile(binary, content)
    await chmod(binary, 0o755)

    await expect(resolvePackagedNativeAnalysis({ binary })).resolves.toEqual({
      command: binary,
      origin: 'explicit',
      target,
      packageVersion,
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  })

  it('fails closed with the exact missing platform package', async () => {
    const fixture = await packagedFixture({ install: false })
    await expect(fixture.resolve()).rejects.toMatchObject({
      code: 'NATIVE_PACKAGE_MISSING',
      target,
    })
  })

  it('accepts a property-order-independent exact artifact manifest', async () => {
    const fixture = await packagedFixture({ reversedArtifact: true })
    await expect(fixture.resolve()).resolves.toMatchObject({
      command: fixture.binary,
      origin: 'package',
      target,
      packageVersion,
    })
  })

  it('rejects platform package version and executable digest drift', async () => {
    const version = await packagedFixture({ childVersion: '0.0.0-invalid-fixture' })
    await expect(version.resolve()).rejects.toMatchObject({
      code: 'NATIVE_PACKAGE_VERSION_MISMATCH',
    })

    const digest = await packagedFixture({ corruptDigest: true })
    await expect(digest.resolve()).rejects.toMatchObject({
      code: 'NATIVE_ARTIFACT_DIGEST_MISMATCH',
    })
  })

  it('rejects an executable symlink escaping its package', async () => {
    const fixture = await packagedFixture({ escapingSymlink: true })
    await expect(fixture.resolve()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
  })

  it('rejects a non-executable explicit file', async () => {
    const root = await directory('codegraph-non-executable-native-')
    const binary = join(root, 'native')
    await writeFile(binary, 'not executable\n')
    await chmod(binary, 0o644)
    await expect(resolvePackagedNativeAnalysis({ binary })).rejects.toEqual(
      expect.objectContaining({
        code: 'NATIVE_ARTIFACT_NOT_EXECUTABLE',
      } satisfies Partial<NativeAnalysisDistributionError>),
    )
  })
})

async function packagedFixture(options: {
  readonly install?: boolean
  readonly childVersion?: string
  readonly corruptDigest?: boolean
  readonly escapingSymlink?: boolean
  readonly reversedArtifact?: boolean
} = {}): Promise<{
  readonly binary: string
  resolve(): Promise<unknown>
}> {
  const root = await directory('codegraph-packaged-native-')
  await cp(join(packageRoot, 'dist'), join(root, 'dist'), {
    recursive: true,
    filter: (source) => !source.endsWith('.js.map'),
  })
  await stripSourceMapComments(join(root, 'dist'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@astrale-os/codegraph', version: packageVersion, type: 'module' }),
  )
  const packageName = targets[target]
  if (!packageName) throw new Error(`Unsupported native distribution test target ${target}.`)
  const executable = 'bin/codegraph-native'
  const packageDirectory = join(root, 'node_modules', ...packageName.split('/'))
  const binary = join(packageDirectory, executable)
  const outside = join(root, 'outside')
  const bytes = Buffer.from('packaged native fixture\n')
  await mkdir(dirname(binary), { recursive: true })
  if (options.escapingSymlink) {
    await writeFile(outside, bytes)
    await chmod(outside, 0o755)
    await symlink(outside, binary)
  } else {
    await writeFile(binary, bytes)
    await chmod(binary, 0o755)
  }
  const artifact = {
    target,
    package: packageName,
    executable,
    bytes: bytes.byteLength,
    sha256: options.corruptDigest
      ? '0'.repeat(64)
      : createHash('sha256').update(bytes).digest('hex'),
  }
  await writeFile(
    join(root, 'native-release.json'),
    JSON.stringify({
      format: 'astrale.codegraph.native-release',
      version: 1,
      packageVersion,
      protocolVersion: 1,
      sourceRevision: '1'.repeat(40),
      toolchain: { ttsc: 'fixture', typescriptGo: 'fixture', go: 'fixture' },
      artifacts: { [target]: artifact },
    }),
  )
  if (options.install !== false) {
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: options.childVersion ?? packageVersion,
        type: 'module',
        exports: { './manifest.json': './manifest.json', './package.json': './package.json' },
      }),
    )
    const manifestArtifact = options.reversedArtifact
      ? Object.fromEntries(Object.entries(artifact).reverse())
      : artifact
    await writeFile(
      join(packageDirectory, 'manifest.json'),
      JSON.stringify({
        format: 'astrale.codegraph.native-artifact',
        version: 1,
        packageVersion,
        protocolVersion: 1,
        artifact: manifestArtifact,
      }),
    )
  }
  const module = await import(
    `${pathToFileURL(join(root, 'dist/analysis/typescript/distribution/index.js')).href}?fixture=${Date.now()}-${Math.random()}`
  ) as { resolvePackagedNativeAnalysis(): Promise<unknown> }
  return { binary: await import('node:fs/promises').then(({ realpath }) => realpath(binary)), resolve: module.resolvePackagedNativeAnalysis }
}

async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporary.push(path)
  return path
}

async function stripSourceMapComments(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await stripSourceMapComments(path)
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = await readFile(path, 'utf8')
      await writeFile(path, source.replace(/\n\/\/# sourceMappingURL=.*\n?$/u, '\n'))
    }
  }
}

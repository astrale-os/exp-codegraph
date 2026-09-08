import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  NativeAnalysisDistributionError,
  resolvePackagedNativeAnalysis,
} from '../analysis/typescript/distribution/index.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  .version as string
const target = `${process.platform}-${process.arch}` as keyof typeof targets
const targets = {
  'darwin-arm64': '@astrale-os/codegraph-native-darwin-arm64',
  'darwin-x64': '@astrale-os/codegraph-native-darwin-x64',
  'linux-arm64': '@astrale-os/codegraph-native-linux-arm64',
  'linux-x64': '@astrale-os/codegraph-native-linux-x64',
  'win32-x64': '@astrale-os/codegraph-native-win32-x64',
} as const

describe('native analysis distribution', () => {
  it('admits an explicit application-controlled executable without ttsc or a release artifact', async () => {
    await withDirectory('codegraph-explicit-native-', async (root) => {
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
  })

  it('fails closed with the exact missing platform package', async () => {
    await withPackagedFixture({ install: false }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({
        code: 'NATIVE_PACKAGE_MISSING',
        target,
      })
    })
  }, 30_000)

  it('accepts a property-order-independent exact artifact manifest', async () => {
    await withPackagedFixture({ reversedArtifact: true }, async (fixture) => {
      await expect(fixture.resolve()).resolves.toMatchObject({
        command: fixture.binary,
        origin: 'package',
        target,
        packageVersion,
      })
    })
  }, 30_000)

  it('rejects platform package version and executable digest drift', async () => {
    await withPackagedFixture({ childVersion: '0.0.0-invalid-fixture' }, async (version) => {
      await expect(version.resolve()).rejects.toMatchObject({
        code: 'NATIVE_PACKAGE_VERSION_MISMATCH',
      })
    })

    await withPackagedFixture({ corruptDigest: true }, async (digest) => {
      await expect(digest.resolve()).rejects.toMatchObject({
        code: 'NATIVE_ARTIFACT_DIGEST_MISMATCH',
      })
    })
  }, 30_000)

  it('rejects an executable symlink escaping its package', async () => {
    await withPackagedFixture({ escapingSymlink: true }, async (fixture) => {
      await expect(fixture.resolve()).rejects.toMatchObject({ code: 'NATIVE_ARTIFACT_INVALID' })
    })
  }, 30_000)

  it.skipIf(process.platform === 'win32')('rejects a non-executable explicit file', async () => {
    await withDirectory('codegraph-non-executable-native-', async (root) => {
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
})

interface PackagedFixture {
  readonly binary: string
  resolve(): Promise<unknown>
}

// Copying and importing a complete distribution is qualification setup, not a
// five-second resolver performance assertion. Each fixture owns its whole async
// lifetime: a runner timeout cannot remove files while cp is still creating them.
async function withPackagedFixture(options: {
  readonly install?: boolean
  readonly childVersion?: string
  readonly corruptDigest?: boolean
  readonly escapingSymlink?: boolean
  readonly reversedArtifact?: boolean
}, check: (fixture: PackagedFixture) => Promise<void>): Promise<void> {
  await withDirectory('codegraph-packaged-native-', async (root) => {
    await check(await packagedFixture(root, options))
  })
}

async function packagedFixture(root: string, options: Parameters<typeof withPackagedFixture>[0]): Promise<PackagedFixture> {
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
  const executable = process.platform === 'win32' ? 'bin/codegraph-native.exe' : 'bin/codegraph-native'
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

async function withDirectory(prefix: string, use: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try { await use(root) }
  finally { await rm(root, { recursive: true, force: true }) }
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

import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import {
  admitNativeArtifactPackageManifest,
  currentNativeAnalysisTarget,
  NATIVE_ARTIFACT_PACKAGES,
  readNativeReleaseManifest,
} from './manifest.ts'
import type {
  PackagedNativeAnalysisOptions,
  ResolvedPackagedNativeAnalysis,
} from './model.ts'
import { NativeAnalysisDistributionError } from './model.ts'

/** Resolve and validate one explicit or package-delivered native analyzer without building it. */
export async function resolvePackagedNativeAnalysis(
  options: PackagedNativeAnalysisOptions = {},
): Promise<ResolvedPackagedNativeAnalysis> {
  const root = packageRoot()
  const packageVersion = await installedPackageVersion(resolve(root, 'package.json'))
  const target = currentNativeAnalysisTarget()
  if (options.binary) {
    const command = resolve(options.binary)
    const admitted = await admitExecutable(command, target)
    return { ...admitted, command, target, packageVersion, origin: 'explicit' }
  }
  const release = await readNativeReleaseManifest(
    resolve(root, 'native-release.json'),
    packageVersion,
    target,
  )
  const artifact = release.artifacts[target as keyof typeof release.artifacts]
  if (!artifact || NATIVE_ARTIFACT_PACKAGES[artifact.target] !== artifact.package) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_TARGET_UNSUPPORTED',
      `Codegraph ${packageVersion} has no native analyzer for ${target}.`,
      target,
    )
  }

  const require = createRequire(import.meta.url)
  let artifactManifestPath: string
  try {
    artifactManifestPath = require.resolve(`${artifact.package}/manifest.json`)
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_PACKAGE_MISSING',
      `Install optional package ${artifact.package}@${packageVersion} for ${target}.`,
      target,
      { cause },
    )
  }
  const artifactRoot = await realpath(dirname(artifactManifestPath))
  const artifactPackageVersion = await installedPackageVersion(resolve(artifactRoot, 'package.json'))
  if (artifactPackageVersion !== packageVersion) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_PACKAGE_VERSION_MISMATCH',
      `${artifact.package} ${artifactPackageVersion} does not match Codegraph ${packageVersion}.`,
      target,
    )
  }
  let packageManifest: unknown
  try {
    packageManifest = JSON.parse(await readFile(artifactManifestPath, 'utf8'))
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `${artifact.package} has no valid artifact manifest.`,
      target,
      { cause },
    )
  }
  admitNativeArtifactPackageManifest(packageManifest, artifact, packageVersion)
  let command: string
  try {
    command = await realpath(resolve(artifactRoot, artifact.executable))
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `${artifact.package} executable is missing or unreadable.`,
      target,
      { cause },
    )
  }
  if (!within(artifactRoot, command)) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `${artifact.package} executable resolves outside its package.`,
      target,
    )
  }
  const admitted = await admitExecutable(command, target)
  if (admitted.bytes !== artifact.bytes || admitted.sha256 !== artifact.sha256) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_DIGEST_MISMATCH',
      `${artifact.package} executable does not match the qualified release manifest.`,
      target,
    )
  }
  return { ...admitted, command, target, packageVersion, origin: 'package' }
}

async function admitExecutable(path: string, target: string): Promise<{
  readonly bytes: number
  readonly sha256: string
}> {
  let metadata
  try {
    metadata = await stat(path)
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `Native analyzer is not a readable regular file: ${path}`,
      target,
      { cause },
    )
  }
  if (!metadata.isFile()) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `Native analyzer is not a regular file: ${path}`,
      target,
    )
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o111) === 0) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_NOT_EXECUTABLE',
      `Native analyzer is not executable: ${path}`,
      target,
    )
  }
  const bytes = await readFile(path)
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function installedPackageVersion(path: string): Promise<string> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { readonly version?: unknown }
    if (typeof value.version === 'string' && value.version.trim()) return value.version
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_RELEASE_MANIFEST_INVALID',
      `Cannot read package version from ${path}.`,
      currentNativeAnalysisTarget(),
      { cause },
    )
  }
  throw new NativeAnalysisDistributionError(
    'NATIVE_RELEASE_MANIFEST_INVALID',
    `Package version is missing from ${path}.`,
    currentNativeAnalysisTarget(),
  )
}

function packageRoot(): string {
  const candidate = resolve(import.meta.dirname, '../../..')
  return basename(candidate) === 'dist' ? dirname(candidate) : candidate
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

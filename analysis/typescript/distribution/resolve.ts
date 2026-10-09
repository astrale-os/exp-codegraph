import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import {
  admitNativeOxlintArtifact,
  currentNativeAnalysisTarget,
  NATIVE_ARTIFACT_DIRECTORY,
  readNativeReleaseManifest,
} from './manifest.ts'
import type {
  PackagedNativeAnalysisOptions,
  NativeAnalysisTarget,
  NativeAnalysisArtifact,
  NativeOxlintArtifact,
  ResolvedPackagedNativeAnalysis,
  ResolvedPackagedNativeOxlint,
} from './model.ts'
import { NativeAnalysisDistributionError } from './model.ts'
import { admitExecutable, materializeNativeArtifact } from './materialize.ts'

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
  const authority = await resolveArtifact(root, packageVersion, target)
  const native = await admitPackagedExecutable(authority.artifactRoot, authority.artifact, target)
  return { ...native, ...(authority.artifact.compression ? { compression: authority.artifact.compression } : {}), target, packageVersion, origin: 'package' }
}

/** Resolve the generic worker independently so the original analyzer can recover without it. */
export async function resolvePackagedNativeOxlint(): Promise<ResolvedPackagedNativeOxlint> {
  const root = packageRoot()
  const packageVersion = await installedPackageVersion(resolve(root, 'package.json'))
  const target = currentNativeAnalysisTarget()
  const authority = await resolveArtifact(root, packageVersion, target)
  const worker = admitNativeOxlintArtifact(authority.artifact)
  const admitted = await admitPackagedExecutable(authority.artifactRoot, worker, target)
  return { ...worker, ...admitted, target, packageVersion, origin: 'package' }
}

async function resolveArtifact(root: string, packageVersion: string, target: string) {
  const release = await readNativeReleaseManifest(
    resolve(root, 'native-release.json'),
    packageVersion,
    target,
  )
  const artifact = release.artifacts[target as NativeAnalysisTarget]
  if (!artifact) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_TARGET_UNSUPPORTED',
      `Codegraph ${packageVersion} has no native analyzer for ${target}.`,
      target,
    )
  }
  const artifactRoot = resolve(await realpath(root), NATIVE_ARTIFACT_DIRECTORY, artifact.target)
  try {
    const canonical = await realpath(artifactRoot)
    if (!within(artifactRoot, canonical)) throw new Error('Artifact directory escapes the package authority.')
    return { artifactRoot: canonical, artifact }
  } catch (cause) {
    throw new NativeAnalysisDistributionError('NATIVE_ARTIFACT_INVALID',
      `Packaged ${target} artifact directory is missing or outside its package authority.`, target, { cause })
  }
}

async function admitPackagedExecutable(
  artifactRoot: string,
  artifact: Pick<NativeAnalysisArtifact | NativeOxlintArtifact, 'executable' | 'bytes' | 'sha256' | 'compression'>,
  target: string,
): Promise<{ readonly command: string; readonly bytes: number; readonly sha256: string }> {
  if (artifact.compression) {
    const command = await materializeNativeArtifact(artifactRoot, artifact, target)
    return { command, bytes: artifact.bytes, sha256: artifact.sha256 }
  }
  let command: string
  try {
    command = await realpath(resolve(artifactRoot, artifact.executable))
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `Packaged ${target} executable ${artifact.executable} is missing or unreadable.`,
      target,
      { cause },
    )
  }
  if (!within(artifactRoot, command)) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_INVALID',
      `Packaged ${target} executable ${artifact.executable} resolves outside its artifact directory.`,
      target,
    )
  }
  const admitted = await admitExecutable(command, target)
  if (admitted.bytes !== artifact.bytes || admitted.sha256 !== artifact.sha256) {
    throw new NativeAnalysisDistributionError(
      'NATIVE_ARTIFACT_DIGEST_MISMATCH',
      `Packaged ${target} executable ${artifact.executable} does not match the qualified release manifest.`,
      target,
    )
  }
  return { ...admitted, command }
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

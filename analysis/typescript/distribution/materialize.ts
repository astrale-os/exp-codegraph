import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import { admitArtifactFile, artifactCacheRoot, materializeArtifact } from '../../../distribution/materialize.ts'
import type { ArtifactRelease } from '../../../distribution/model.ts'
import { ArtifactDistributionError } from '../../../distribution/model.ts'
import type { NativeAnalysisArtifact, NativeOxlintArtifact } from './model.ts'
import { NativeAnalysisDistributionError } from './model.ts'

type Executable = Pick<NativeAnalysisArtifact | NativeOxlintArtifact, 'executable' | 'bytes' | 'sha256' | 'compression'>

/** Native admission shares one file-cache owner with the viewer's source-bound bundle. */
export async function materializeNativeArtifact(
  artifactRoot: string | ArtifactRelease,
  artifact: Executable,
  target: string,
  cacheRoot = artifactCacheRoot('native'),
  signal?: AbortSignal,
): Promise<string> {
  try {
    if (!artifact.compression) throw new Error('Materialization requires an encoded artifact.')
    const source = typeof artifactRoot === 'string'
      ? { root: await realpath(artifactRoot), path: resolve(artifactRoot, artifact.compression.path) }
      : { release: artifactRoot, asset: artifact.compression.path }
    return await materializeArtifact(source, artifact, {
      cacheRoot, cacheKey: `${target}-${artifact.sha256}${target === 'win32-x64' ? '.exe' : ''}`,
      executable: true, signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw signal.reason
    throw nativeFailure(cause, target)
  }
}

export async function admitExecutable(path: string, target: string): Promise<{ bytes: number; sha256: string }> {
  try { return await admitArtifactFile(path, true) } catch (cause) { throw nativeFailure(cause, target) }
}

function nativeFailure(cause: unknown, target: string): NativeAnalysisDistributionError {
  const code = cause instanceof ArtifactDistributionError ? {
    ARTIFACT_INVALID: 'NATIVE_ARTIFACT_INVALID',
    ARTIFACT_DIGEST_MISMATCH: 'NATIVE_ARTIFACT_DIGEST_MISMATCH',
    ARTIFACT_NOT_EXECUTABLE: 'NATIVE_ARTIFACT_NOT_EXECUTABLE',
    ARTIFACT_DOWNLOAD_FAILED: 'NATIVE_ARTIFACT_DOWNLOAD_FAILED',
  }[cause.code] as ConstructorParameters<typeof NativeAnalysisDistributionError>[0] : 'NATIVE_ARTIFACT_INVALID'
  return new NativeAnalysisDistributionError(code,
    cause instanceof Error ? cause.message : `Cannot admit ${target} native artifact.`, target, { cause })
}

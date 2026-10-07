export type NativeAnalysisTarget =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-arm64'
  | 'linux-x64'
  | 'win32-x64'

export interface NativeAnalysisArtifact {
  readonly target: NativeAnalysisTarget
  readonly package: string
  readonly executable: string
  readonly bytes: number
  readonly sha256: string
  readonly oxlint?: NativeOxlintArtifact
}

export interface NativeOxlintArtifact {
  readonly executable: string
  readonly bytes: number
  readonly sha256: string
  readonly engineVersion: '1.81.0'
  readonly protocolVersion: 1
  readonly source: {
    readonly revision: string
    readonly patchSha256: string
  }
}

export interface NativeAnalysisReleaseManifest {
  readonly format: 'astrale.codegraph.native-release'
  readonly version: 1
  readonly packageVersion: string
  readonly protocolVersion: 1
  readonly sourceRevision: string
  readonly toolchain: {
    readonly ttsc: string
    readonly typescriptGo: string
    readonly go: string
    readonly oxlint?: {
      readonly rustc: string
      readonly cargo: string
      readonly cargoLockSha256: string
    }
  }
  readonly artifacts: Readonly<Partial<Record<NativeAnalysisTarget, NativeAnalysisArtifact>>>
}

export type NativeAnalysisDistributionErrorCode =
  | 'NATIVE_RELEASE_MANIFEST_INVALID'
  | 'NATIVE_TARGET_UNSUPPORTED'
  | 'NATIVE_PACKAGE_MISSING'
  | 'NATIVE_PACKAGE_VERSION_MISMATCH'
  | 'NATIVE_ARTIFACT_INVALID'
  | 'NATIVE_ARTIFACT_DIGEST_MISMATCH'
  | 'NATIVE_ARTIFACT_NOT_EXECUTABLE'
  | 'NATIVE_OXLINT_UNAVAILABLE'

export class NativeAnalysisDistributionError extends Error {
  readonly code: NativeAnalysisDistributionErrorCode
  readonly target: string
  constructor(
    code: NativeAnalysisDistributionErrorCode,
    message: string,
    target: string,
    options?: ErrorOptions,
  )
}

export interface PackagedNativeAnalysisOptions {
  /** Explicit application-controlled qualified executable. */
  readonly binary?: string
}

export interface ResolvedPackagedNativeAnalysis {
  readonly command: string
  readonly sha256: string
  readonly bytes: number
  readonly target: string
  readonly packageVersion: string
  readonly origin: 'explicit' | 'package'
}

/** Resolve and validate one explicit or package-delivered native analyzer without building it. */
export function resolvePackagedNativeAnalysis(
  options?: PackagedNativeAnalysisOptions,
): Promise<ResolvedPackagedNativeAnalysis>

/** Companion admission is independent from Go analyzer availability. */
export interface ResolvedPackagedNativeOxlint extends NativeOxlintArtifact {
  readonly command: string
  readonly target: string
  readonly packageVersion: string
  readonly origin: 'package'
}

export function resolvePackagedNativeOxlint(): Promise<ResolvedPackagedNativeOxlint>

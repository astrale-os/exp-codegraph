type ViewerQualificationStatus = 'pass' | 'fail' | 'idle' | 'error'
type ViewerQualificationSeverity = 'error' | 'warning' | 'info'

interface ViewerQualificationLocation {
  readonly file?: string
  readonly external?: string
  readonly line?: number
  readonly column?: number
  readonly pointer?: string
  readonly label?: string
}

interface ViewerQualificationDiagnostic {
  readonly code?: string
  readonly message: string
  readonly severity?: ViewerQualificationSeverity
  readonly location?: ViewerQualificationLocation
  readonly related?: readonly ViewerQualificationLocation[]
  readonly expected?: unknown
  readonly actual?: unknown
  readonly hint?: string
}

interface ViewerQualificationRule {
  readonly id: string
  readonly status: ViewerQualificationStatus
  readonly diagnostics: readonly ViewerQualificationDiagnostic[]
}

interface ViewerQualificationCoverageItem {
  readonly id: string
  readonly label: string
  readonly location?: ViewerQualificationLocation
}

interface ViewerQualificationCoverageDirection {
  readonly matched: number
  readonly total: number
  readonly percent: number | null
  readonly unmatched: readonly ViewerQualificationCoverageItem[]
}

interface ViewerQualificationTarget {
  readonly id: string
  readonly adapter: string
  readonly project: string
  readonly root: string
  readonly entrypoint: string
  readonly facades?: readonly string[]
  readonly aliases?: readonly string[]
  readonly internals?: readonly string[]
}

interface ViewerQualificationDependencyEvidence {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: string
  readonly deep: boolean
  readonly location?: ViewerQualificationLocation
}

interface ViewerQualificationProofEvidence {
  readonly exactDeclarations: readonly ViewerQualificationCoverageItem[]
  readonly identityDeclarations: readonly ViewerQualificationCoverageItem[]
  readonly unprovenObservations: readonly ViewerQualificationDiagnostic[]
}

interface ViewerQualificationProfileEvidence {
  readonly observedModules?: readonly string[]
  readonly missingSurface?: readonly ViewerQualificationCoverageItem[]
  readonly undeclaredSurface?: readonly ViewerQualificationCoverageItem[]
  readonly outboundDependencies?: readonly ViewerQualificationDependencyEvidence[]
  readonly inboundDependencies?: readonly ViewerQualificationDependencyEvidence[]
  readonly proof?: ViewerQualificationProofEvidence
}

interface ViewerQualificationProfile {
  readonly id: string
  readonly provider: string
  readonly target?: ViewerQualificationTarget
  readonly status: ViewerQualificationStatus
  readonly rules: readonly ViewerQualificationRule[]
  readonly coverage?: {
    readonly forward: ViewerQualificationCoverageDirection
    readonly inverse: ViewerQualificationCoverageDirection
  }
  readonly evidence?: ViewerQualificationProfileEvidence
}

interface ViewerQualification {
  readonly status: ViewerQualificationStatus
  readonly profiles: readonly ViewerQualificationProfile[]
  readonly rules: readonly ViewerQualificationRule[]
  readonly dependencies: readonly string[]
  readonly durationMs: number
}

export const SOURCE_EDIT_PROTOCOL: 'astrale.spec.editing.v2'
export const SOURCE_EDIT_ENDPOINT: '/__astrale/spec-source'
export const SOURCE_EDIT_HEADER: 'x-astrale-spec-edit'

export interface SourceEditRequest {
  source: string
  revision: string
  text: string
}
export interface SourceEditOptions { signal?: AbortSignal }
export interface SourceSaved { status: 'saved'; revision: string }
export interface SourceConflict { status: 'conflict'; revision: string; text: string }
export interface SourceEditError { status: 'error'; message: string }
export type SourceEditResponse = SourceSaved | SourceConflict | SourceEditError
export interface SourceEditAdapter {
  save(request: SourceEditRequest, options?: SourceEditOptions): Promise<SourceEditResponse>
}
export interface SourceEditHttpAdapterManifest {
  transport: 'http'
  protocol: typeof SOURCE_EDIT_PROTOCOL
  endpoint: string
}
export class SourceEditAdapterError extends Error { readonly code: string }

export const SPEC_REVEAL_PROTOCOL: 'astrale.spec.reveal.v2'
export const SPEC_REVEAL_ENDPOINT: '/__astrale/spec-reveal'
export const SPEC_REVEAL_HEADER: 'x-astrale-spec-reveal'
export interface SpecRevealRequest { source: string }
export interface SpecRevealOptions { signal?: AbortSignal }
export interface SpecRevealAdapter {
  reveal(request: SpecRevealRequest, options?: SpecRevealOptions): Promise<void>
}
export interface SpecRevealHttpAdapterManifest {
  transport: 'http'
  protocol: typeof SPEC_REVEAL_PROTOCOL
  endpoint: string
}
export type SpecRevealErrorCode =
  | 'REQUEST_INVALID'
  | 'SNAPSHOT_CHANGED'
  | 'SOURCE_NOT_FOUND'
  | 'REVEAL_FAILED'
export type SpecRevealResponse =
  | { protocol: typeof SPEC_REVEAL_PROTOCOL; status: 'revealed'; source: string }
  | {
      protocol: typeof SPEC_REVEAL_PROTOCOL
      status: 'rejected'
      code: SpecRevealErrorCode
      message: string
    }
export class SpecRevealAdapterError extends Error { readonly code: string }

export const VERIFICATION_PROTOCOL: 'astrale.spec.verification.v2'
export const VERIFICATION_ENDPOINT: '/__astrale/spec-verification'
export const VERIFICATION_HEADER: 'x-astrale-spec-verification'
export interface VerificationRun { source: string; revision: string }
export interface VerificationRunOptions { signal?: AbortSignal }
export interface VerificationAdapter {
  run(request: VerificationRun, options?: VerificationRunOptions): Promise<ViewerQualification>
}
export interface VerificationHttpAdapterManifest {
  transport: 'http'
  protocol: typeof VERIFICATION_PROTOCOL
  endpoint: string
}
export interface VerificationRunRequest extends VerificationRun {
  protocol: typeof VERIFICATION_PROTOCOL
}
export type VerificationRejectionCode =
  | 'REQUEST_INVALID'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_CHANGED'
  | 'SPEC_INVALID'
  | 'VERIFIER_MISSING'
  | 'EXECUTION_FAILED'
export type VerificationRunResponse =
  | {
      protocol: typeof VERIFICATION_PROTOCOL
      status: 'completed'
      source: string
      revision: string
      verification: ViewerQualification
    }
  | {
      protocol: typeof VERIFICATION_PROTOCOL
      status: 'rejected'
      code: VerificationRejectionCode
      message: string
      source?: string
      revision?: string
    }
export class VerificationAdapterError extends Error { readonly code: string }

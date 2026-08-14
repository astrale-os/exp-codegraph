import type { ViewerQualification } from './qualification-model.ts'

export type {
  ViewerQualification,
  ViewerQualificationCoverageDirection,
  ViewerQualificationCoverageItem,
  ViewerQualificationDependencyEvidence,
  ViewerQualificationDiagnostic,
  ViewerQualificationLocation,
  ViewerQualificationProfile,
  ViewerQualificationProfileEvidence,
  ViewerQualificationProofEvidence,
  ViewerQualificationRule,
  ViewerQualificationSeverity,
  ViewerQualificationStatus,
  ViewerQualificationTarget,
} from './qualification-model.ts'

export const VERIFICATION_PROTOCOL = 'astrale.spec.verification.v2' as const
export const VERIFICATION_ENDPOINT = '/__astrale/spec-verification'
export const VERIFICATION_HEADER = 'x-astrale-spec-verification'

export interface VerificationRun {
  source: string
  revision: string
}

export interface VerificationRunOptions {
  signal?: AbortSignal
}

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

export interface VerificationCompleted extends VerificationRunRequest {
  status: 'completed'
  verification: ViewerQualification
}

export interface VerificationRejected {
  protocol: typeof VERIFICATION_PROTOCOL
  status: 'rejected'
  code: VerificationRejectionCode
  message: string
  source?: string
  revision?: string
}

export type VerificationRunResponse = VerificationCompleted | VerificationRejected

export class VerificationAdapterError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VerificationAdapterError'
    this.code = code
  }
}

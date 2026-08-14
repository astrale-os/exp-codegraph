export type ViewerQualificationStatus = 'pass' | 'fail' | 'idle' | 'error'
export type ViewerQualificationSeverity = 'error' | 'warning' | 'info'

export interface ViewerQualificationLocation {
  readonly file?: string
  readonly external?: string
  readonly line?: number
  readonly column?: number
  readonly pointer?: string
  readonly label?: string
}

export interface ViewerQualificationDiagnostic {
  readonly code?: string
  readonly message: string
  readonly severity?: ViewerQualificationSeverity
  readonly location?: ViewerQualificationLocation
  readonly related?: readonly ViewerQualificationLocation[]
  readonly expected?: unknown
  readonly actual?: unknown
  readonly hint?: string
}

export interface ViewerQualificationRule {
  readonly id: string
  readonly status: ViewerQualificationStatus
  readonly diagnostics: readonly ViewerQualificationDiagnostic[]
}

export interface ViewerQualificationCoverageItem {
  readonly id: string
  readonly label: string
  readonly location?: ViewerQualificationLocation
}

export interface ViewerQualificationCoverageDirection {
  readonly matched: number
  readonly total: number
  readonly percent: number | null
  readonly unmatched: readonly ViewerQualificationCoverageItem[]
}

export interface ViewerQualificationTarget {
  readonly id: string
  readonly adapter: string
  readonly project: string
  readonly root: string
  readonly entrypoint: string
  readonly facades?: readonly string[]
  readonly aliases?: readonly string[]
  readonly internals?: readonly string[]
}

export interface ViewerQualificationDependencyEvidence {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: string
  readonly deep: boolean
  readonly location?: ViewerQualificationLocation
}

export interface ViewerQualificationProofEvidence {
  readonly exactDeclarations: readonly ViewerQualificationCoverageItem[]
  readonly identityDeclarations: readonly ViewerQualificationCoverageItem[]
  readonly unprovenObservations: readonly ViewerQualificationDiagnostic[]
}

export interface ViewerQualificationProfileEvidence {
  readonly observedModules?: readonly string[]
  readonly missingSurface?: readonly ViewerQualificationCoverageItem[]
  readonly undeclaredSurface?: readonly ViewerQualificationCoverageItem[]
  readonly outboundDependencies?: readonly ViewerQualificationDependencyEvidence[]
  readonly inboundDependencies?: readonly ViewerQualificationDependencyEvidence[]
  readonly proof?: ViewerQualificationProofEvidence
}

export interface ViewerQualificationProfile {
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

/** Presentation-safe qualification projection carried by the application interaction protocol. */
export interface ViewerQualification {
  readonly status: ViewerQualificationStatus
  readonly profiles: readonly ViewerQualificationProfile[]
  readonly rules: readonly ViewerQualificationRule[]
  readonly dependencies: readonly string[]
  readonly durationMs: number
}

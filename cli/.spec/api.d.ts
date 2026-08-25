export interface CliCheckEvidence {
  readonly repository: string
  readonly inventory: string
  readonly snapshot: string
}

export type CliCheckOutputFormat = 'text' | 'json'

export interface CliDiagnosticGroup {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  /** Every distinct specification projection that observed this exact source cause. */
  readonly pointers: readonly (string | null)[]
}

export type CliCheckScope =
  | {
      readonly kind: 'full'
      readonly specifications: readonly string[]
    }
  | {
      readonly kind: 'focused'
      readonly requested: readonly string[]
      readonly selected: readonly string[]
      readonly support: readonly string[]
    }

export interface CliCheckReport {
  readonly format: 'astrale.codegraph.check-report'
  readonly version: 1
  readonly command: 'check'
  readonly status: 'pass' | 'fail'
  readonly evidence: CliCheckEvidence
  readonly scope: CliCheckScope
  readonly qualificationFailed: boolean
  readonly diagnostics: readonly CliDiagnosticGroup[]
  readonly summary: {
    readonly specifications: number
    readonly diagnosticCauses: number
    readonly diagnosticOccurrences: number
  }
}

export interface CliAccelerationEvent {
  readonly operation:
    | 'source-proof'
    | 'semantic-pack-read'
    | 'semantic-pack-publish'
    | 'workspace-result-read'
    | 'workspace-result-publish'
    | 'catalog-read'
    | 'catalog-publish'
    | 'admission'
  readonly outcome: 'admitted' | 'hit' | 'miss' | 'published' | 'fallback' | 'failed'
  readonly code: string
  readonly durationMs: number
  readonly work?: {
    readonly bytesRead?: number
    readonly bytesWritten?: number
    readonly bytesDecoded?: number
    readonly loadedShards?: number
    readonly writtenShards?: number
  }
  readonly error?: { readonly name: string; readonly message: string }
}

export interface CliAccelerationReceipt {
  readonly format: 'astrale.codegraph.cli-acceleration-receipt'
  readonly version: 1
  readonly events: readonly CliAccelerationEvent[]
}

export interface CliCheckResult {
  readonly exitCode: number
  readonly check: CliCheckEvidence
  readonly acceleration?: CliAccelerationReceipt
}

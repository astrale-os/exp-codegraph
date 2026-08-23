export interface CliCheckEvidence {
  readonly repository: string
  readonly inventory: string
  readonly snapshot: string
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

export interface CliCheckEvidence {
  readonly repository: string
  readonly inventory: string
  readonly snapshot: string
}

export interface CliCheckResult {
  readonly exitCode: number
  readonly check: CliCheckEvidence
}

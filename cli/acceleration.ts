export type CliAccelerationOperation =
  | 'source-proof'
  | 'semantic-pack-read'
  | 'semantic-pack-publish'
  | 'workspace-result-read'
  | 'workspace-result-publish'
  | 'catalog-read'
  | 'catalog-publish'
  | 'admission'

export interface CliAccelerationEvent {
  readonly operation: CliAccelerationOperation
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

/** Non-semantic evidence for every advisory acceleration decision in one command. */
export interface CliAccelerationReceipt {
  readonly format: 'astrale.codegraph.cli-acceleration-receipt'
  readonly version: 1
  readonly events: readonly CliAccelerationEvent[]
}

export function createCliAccelerationReceipt(
  events: readonly CliAccelerationEvent[],
): CliAccelerationReceipt {
  return Object.freeze({
    format: 'astrale.codegraph.cli-acceleration-receipt',
    version: 1,
    events: Object.freeze(events.map((event) => Object.freeze(event))),
  })
}

export function cliAccelerationError(error: unknown): {
  readonly name: string
  readonly message: string
} {
  const name = error instanceof Error ? error.name : 'unknown'
  const input = error instanceof Error ? error.message : String(error)
  const message = input.length <= 1_000 ? input : `${input.slice(0, 1_000)}…`
  return { name, message }
}

export function createCliAccelerationEvent(
  operation: CliAccelerationOperation,
  outcome: CliAccelerationEvent['outcome'],
  code: string,
  started: number,
  error?: unknown,
): CliAccelerationEvent {
  return {
    operation,
    outcome,
    code,
    durationMs: performance.now() - started,
    ...(error === undefined ? {} : { error: cliAccelerationError(error) }),
  }
}

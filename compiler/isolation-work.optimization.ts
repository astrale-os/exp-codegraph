import { operationSnapshot, operationSnapshotNamespace } from '../source/operation-snapshot.ts'

export interface ApiCompilerIsolationWork {
  readonly sessions: number
  readonly programs: number
  readonly retries: number
  readonly plannerFallbacks: number
  readonly workerPeakResidentBytes: number
  readonly workerResidentUpperBoundBytes: number
}

const isolationWork = operationSnapshotNamespace<ApiCompilerIsolationWork>(
  'api-compiler-isolation-work',
)

/** Count actual worker and Program construction without changing the isolated protocol. */
export function recordApiCompilerIsolationWork(
  delta: Partial<ApiCompilerIsolationWork>,
): void {
  const values = operationSnapshot(isolationWork)
  if (!values) return
  const current = apiCompilerIsolationWork()
  values.set('work', {
    sessions: current.sessions + (delta.sessions ?? 0),
    programs: current.programs + (delta.programs ?? 0),
    retries: current.retries + (delta.retries ?? 0),
    plannerFallbacks: current.plannerFallbacks + (delta.plannerFallbacks ?? 0),
    workerPeakResidentBytes: Math.max(
      current.workerPeakResidentBytes,
      delta.workerPeakResidentBytes ?? 0,
    ),
    workerResidentUpperBoundBytes:
      current.workerResidentUpperBoundBytes + (delta.workerResidentUpperBoundBytes ?? 0),
  })
}

export function apiCompilerIsolationWork(): ApiCompilerIsolationWork {
  return operationSnapshot(isolationWork)?.get('work') ?? {
    sessions: 0,
    programs: 0,
    retries: 0,
    plannerFallbacks: 0,
    workerPeakResidentBytes: 0,
    workerResidentUpperBoundBytes: 0,
  }
}

const RESOURCE_FORMAT = 'astrale.codegraph.api-compiler-worker-resource'

/** Produce one private completion record from Node's cross-platform peak-RSS accounting. */
export function apiCompilerWorkerResourceReport(): string {
  const peakResidentBytes = process.resourceUsage().maxRSS * 1_024
  if (!Number.isSafeInteger(peakResidentBytes) || peakResidentBytes < 1) {
    throw new Error('API compiler worker peak resident memory is unavailable.')
  }
  return JSON.stringify({ format: RESOURCE_FORMAT, version: 1, peakResidentBytes })
}

export function parseApiCompilerWorkerResourceReport(input: Uint8Array): number {
  const value: unknown = JSON.parse(Buffer.from(input).toString('utf8').trim())
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { readonly format?: unknown }).format !== RESOURCE_FORMAT ||
    (value as { readonly version?: unknown }).version !== 1 ||
    !Number.isSafeInteger((value as { readonly peakResidentBytes?: unknown }).peakResidentBytes) ||
    (value as { readonly peakResidentBytes: number }).peakResidentBytes < 1
  ) {
    throw new Error('API compiler worker resource report is invalid.')
  }
  return (value as { readonly peakResidentBytes: number }).peakResidentBytes
}

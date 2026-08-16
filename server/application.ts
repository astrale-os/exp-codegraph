import type { TypeSpecApplicationService } from '../application/index.ts'
import type { CodegraphApplicationSessionOptions } from '../application/analysis/index.ts'
import type { AnalysisTelemetrySink } from '../analysis/index.ts'
import { createNodeTypeSpecApplicationService } from '../application/node/index.ts'
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.ts'

/** Dev-server application composition; the live plugin owns and disposes the returned service. */
export function createServerApplicationService(
  root: string,
  cache: boolean,
  native?: CodegraphApplicationSessionOptions,
  telemetry?: AnalysisTelemetrySink,
): Promise<TypeSpecApplicationService> {
  return createNodeTypeSpecApplicationService({
    root,
    cacheDirectory: defaultTypeSpecCacheDirectory(),
    persistence: cache ? 'advisory' : 'memory',
    // The dev server exposes only its current coherent projection. An open reader
    // already leases the replaced generation until publication completes.
    maximumRetainedSnapshots: 1,
    maximumRetainedGenerations: 1,
    ...(telemetry ? { telemetry } : {}),
    ...(native ? { native } : {}),
  })
}

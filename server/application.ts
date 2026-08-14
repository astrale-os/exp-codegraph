import type { TypeSpecApplicationService } from '../application/index.ts'
import { createNodeTypeSpecApplicationService } from '../application/node/index.ts'
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.ts'

/** Dev-server application composition; the live plugin owns and disposes the returned service. */
export function createServerApplicationService(
  root: string,
  cache: boolean,
): Promise<TypeSpecApplicationService> {
  return createNodeTypeSpecApplicationService({
    root,
    cacheDirectory: defaultTypeSpecCacheDirectory(),
    persistence: cache ? 'advisory' : 'memory',
    maximumRetainedSnapshots: 2,
    maximumRetainedGenerations: 2,
  })
}

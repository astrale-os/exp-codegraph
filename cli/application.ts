import type { TypeSpecApplicationService } from '../application/index.ts'
import type { CliPortableCheckpoint } from './run.ts'
import { createNodeTypeSpecApplicationService } from '../application/node/index.ts'
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.ts'

/** CLI-owned persistence and cache defaults around the headless application service. */
export async function createCliApplicationService(
  root: string,
  cache: boolean,
  portableCheckpoint?: CliPortableCheckpoint,
): Promise<TypeSpecApplicationService> {
  return createNodeTypeSpecApplicationService({
    root,
    cacheDirectory: defaultTypeSpecCacheDirectory(),
    persistence: cache ? 'advisory' : 'memory',
    ...(portableCheckpoint ? { portableCheckpoint } : {}),
  })
}

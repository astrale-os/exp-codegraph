import { createNodeTypeSpecApplicationService } from '../application/node/index.js';
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.js';
/** CLI-owned persistence and cache defaults around the headless application service. */
export async function createCliApplicationService(root, cache, portableCheckpoint) {
    return createNodeTypeSpecApplicationService({
        root,
        cacheDirectory: defaultTypeSpecCacheDirectory(),
        persistence: cache ? 'advisory' : 'memory',
        ...(portableCheckpoint ? { portableCheckpoint } : {}),
    });
}
//# sourceMappingURL=application.js.map
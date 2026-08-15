import { createNodeTypeSpecApplicationService } from '../application/node/index.js';
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.js';
/** CLI-owned persistence and cache defaults around the headless application service. */
export async function createCliApplicationService(root, cache) {
    return createNodeTypeSpecApplicationService({
        root,
        cacheDirectory: defaultTypeSpecCacheDirectory(),
        persistence: cache ? 'advisory' : 'memory',
    });
}
//# sourceMappingURL=application.js.map
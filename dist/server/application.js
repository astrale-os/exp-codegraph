import { createNodeTypeSpecApplicationService } from '../application/node/index.js';
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.js';
/** Dev-server application composition; the live plugin owns and disposes the returned service. */
export function createServerApplicationService(root, cache, native) {
    return createNodeTypeSpecApplicationService({
        root,
        cacheDirectory: defaultTypeSpecCacheDirectory(),
        persistence: cache ? 'advisory' : 'memory',
        maximumRetainedSnapshots: 2,
        maximumRetainedGenerations: 2,
        ...(native ? { native } : {}),
    });
}
//# sourceMappingURL=application.js.map
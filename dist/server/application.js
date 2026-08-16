import { createNodeTypeSpecApplicationService } from '../application/node/index.js';
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.js';
/** Dev-server application composition; the live plugin owns and disposes the returned service. */
export function createServerApplicationService(root, cache, native, telemetry) {
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
    });
}
//# sourceMappingURL=application.js.map
import { resolve } from 'node:path';
import { deriveAnalysisId, portablePath } from '../../analysis/index.js';
import { readBytesBounded, sourceRevision } from '../../source/file.js';
export const DEFAULT_REPOSITORY_SOURCE_MAXIMUM_TEXT_BYTES = 16 * 1024 * 1024;
/** Read text only when its bytes still match one immutable repository inventory. */
export function createRepositorySourceService(root, inventory, options = {}) {
    const maximumTextBytes = options.maximumTextBytes ?? DEFAULT_REPOSITORY_SOURCE_MAXIMUM_TEXT_BYTES;
    if (!Number.isSafeInteger(maximumTextBytes) || maximumTextBytes < 0) {
        throw new Error('maximumTextBytes must be a non-negative safe integer.');
    }
    const bySource = new Map(inventory.files.map((file) => [file.source, file]));
    const byPath = new Map(inventory.files.map((file) => [file.path, file]));
    return {
        inventory: inventory.revision,
        async read(request) {
            request.signal?.throwIfAborted();
            let file;
            try {
                file = 'source' in request && request.source
                    ? bySource.get(request.source)
                    : byPath.get(portablePath(request.path));
            }
            catch {
                file = undefined;
            }
            if (!file) {
                return {
                    status: 'unavailable',
                    inventory: inventory.revision,
                    ...('source' in request && request.source ? { source: request.source } : {}),
                    ...('path' in request ? { path: request.path } : {}),
                    reason: 'not-in-inventory',
                };
            }
            const expected = request.revision ?? file.revision;
            if (expected !== file.revision) {
                return {
                    status: 'stale',
                    inventory: inventory.revision,
                    source: file.source,
                    expected,
                    actual: file.revision,
                    path: file.path,
                };
            }
            if (file.content !== 'text') {
                return {
                    status: 'unavailable',
                    inventory: inventory.revision,
                    source: file.source,
                    reason: 'not-text',
                    path: file.path,
                };
            }
            try {
                const bytes = await readBytesBounded(resolve(root, file.path), maximumTextBytes);
                const text = decodeUtf8(bytes);
                request.signal?.throwIfAborted();
                const actual = deriveAnalysisId('source-revision', `${file.source}`, {
                    digest: sourceRevision(bytes),
                    encoding: 'bytes',
                });
                if (actual !== expected) {
                    return {
                        status: 'stale',
                        inventory: inventory.revision,
                        source: file.source,
                        expected,
                        actual,
                        path: file.path,
                    };
                }
                return {
                    status: 'current',
                    inventory: inventory.revision,
                    source: file.source,
                    revision: actual,
                    path: file.path,
                    text,
                };
            }
            catch (error) {
                return {
                    status: 'unavailable',
                    inventory: inventory.revision,
                    source: file.source,
                    reason: 'unreadable',
                    path: file.path,
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}
function decodeUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        throw new Error('File is not valid UTF-8.', { cause: error });
    }
}
//# sourceMappingURL=service.js.map
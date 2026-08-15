import { createHash } from 'node:crypto';
import { deriveAnalysisId, portablePath } from '../identity/index.js';
/** Read source only through an explicit service and prove its generation digest before display. */
export async function readVerifiedSourceText(expectation, reader, options = {}) {
    const logicalPath = portablePath(expectation.logicalPath);
    options.signal?.throwIfAborted();
    let text;
    try {
        text = await reader.read(logicalPath, options);
    }
    catch (error) {
        if (options.signal?.aborted)
            options.signal.throwIfAborted();
        return immutable({
            kind: 'unavailable',
            source: expectation.source,
            revision: expectation.revision,
            logicalPath,
            code: 'SOURCE_TEXT_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
        });
    }
    options.signal?.throwIfAborted();
    const actualDigest = createHash('sha256').update(text).digest('hex');
    const actualRevision = deriveAnalysisId('source-revision', expectation.source, {
        digest: actualDigest,
    });
    if (actualDigest !== expectation.textDigest || actualRevision !== expectation.revision) {
        return immutable({
            kind: 'stale',
            source: expectation.source,
            revision: expectation.revision,
            logicalPath,
            expectedDigest: expectation.textDigest,
            actualDigest,
            actualRevision,
        });
    }
    return immutable({
        kind: 'verified',
        source: expectation.source,
        revision: expectation.revision,
        logicalPath,
        textDigest: actualDigest,
        text,
    });
}
function immutable(value) {
    return Object.freeze(value);
}
//# sourceMappingURL=verify.js.map
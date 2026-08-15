import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { portablePath } from '../identity/index.js';
/** Construct a filesystem reader under one explicit application-owned root. */
export function createNodeSourceTextReader(root) {
    const absoluteRoot = resolve(root);
    return {
        async read(path, options) {
            const admitted = portablePath(path);
            options?.signal?.throwIfAborted();
            return readFile(resolve(absoluteRoot, ...admitted.split('/')), {
                encoding: 'utf8',
                ...(options?.signal ? { signal: options.signal } : {}),
            });
        },
    };
}
//# sourceMappingURL=node-reader.js.map
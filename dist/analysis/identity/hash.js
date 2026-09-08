import { createHash } from 'node:crypto';
/** Internal identity framing, shared by whole-value and bounded streaming encoders. */
export function createAnalysisIdentityHash(kind, namespace) {
    if (!/^[a-z][a-z0-9-]*$/u.test(kind))
        throw new TypeError(`Invalid analysis identity kind: ${kind}`);
    if (!namespace || namespace.includes('\0'))
        throw new TypeError('Identity namespace is required.');
    return createHash('sha256').update('astrale.analysis.identity\0')
        .update(kind).update('\0').update(namespace).update('\0');
}
//# sourceMappingURL=hash.js.map
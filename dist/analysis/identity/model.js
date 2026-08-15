import { createHash } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';
const kindPattern = /^[a-z][a-z0-9-]*$/u;
const valuePattern = /^[a-z][a-z0-9-]*:[a-f0-9]{64}$/u;
export function admitAnalysisId(kind, value) {
    if (!kindPattern.test(kind))
        throw new TypeError(`Invalid analysis identity kind: ${kind}`);
    if (!valuePattern.test(value) || !value.startsWith(`${kind}:`)) {
        throw new TypeError(`Invalid ${kind} analysis identity: ${value}`);
    }
    return value;
}
export function deriveAnalysisId(kind, namespace, input) {
    if (!kindPattern.test(kind))
        throw new TypeError(`Invalid analysis identity kind: ${kind}`);
    if (!namespace || namespace.includes('\0'))
        throw new TypeError('Identity namespace is required.');
    const digest = createHash('sha256')
        .update('astrale.analysis.identity\0')
        .update(kind)
        .update('\0')
        .update(namespace)
        .update('\0')
        .update(stableJson(input))
        .digest('hex');
    return `${kind}:${digest}`;
}
export function portablePath(path) {
    if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) {
        throw new TypeError(`Analysis path must be a non-empty relative POSIX path: ${path}`);
    }
    const normalized = posix.normalize(path);
    if (normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/')) {
        throw new TypeError(`Analysis path escapes its logical root: ${path}`);
    }
    return normalized;
}
export function stableJson(value) {
    // Go's encoding/json always escapes the two JSON-valid JavaScript line
    // separators for JSONP safety. Preserve that portable spelling here while
    // leaving literal backslash-u text untouched.
    return JSON.stringify(canonical(value))
        .replaceAll('\u2028', '\\u2028')
        .replaceAll('\u2029', '\\u2029');
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value === undefined)
        return { $undefined: true };
    if (typeof value === 'bigint')
        return { $bigint: value.toString() };
    if (!value || typeof value !== 'object')
        return value;
    if (value instanceof Date)
        return { $date: value.toISOString() };
    return Object.fromEntries(Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        // Go's encoding/json orders valid UTF-8 map keys by Unicode scalar value.
        // Locale collation is machine-dependent and, even for ASCII, places
        // `callables` before `callSignatureCount`; that made native digests fail
        // only once a real surface contained both keys.
        .sort(([left], [right]) => compareUnicodeScalars(left, right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
function compareUnicodeScalars(left, right) {
    const a = [...left];
    const b = [...right];
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
        const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
        if (difference)
            return difference;
    }
    return a.length - b.length;
}
//# sourceMappingURL=model.js.map